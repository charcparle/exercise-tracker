const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const cors = require('cors')
const mongoose = require('mongoose')
// Handle CORS
app.use(cors({ optionsSuccessStatus: 204 }))

// Request Logger
app.use((req, res, next) => {
  console.log(req.method + " " + req.path + " - " + req.ip);
  next();
})

// Mongoose - Connect to MongoDB

mongoose.connect(process.env.DB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('Connection to the Atlas Cluster is successful!')
  })
  .catch((err) => console.error(err));

// Mount the body-parser middleware
app.use(bodyParser.urlencoded({ extended: false }))
app.use(bodyParser.json())

// Serve static files
app.use(express.static('public'))
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html')
});


// Not found middleware
//app.use((req, res, next) => {
//return next({status: 404, message: 'not found'})
//})

// Error Handling middleware (from boilerplate)
app.use((err, req, res, next) => {
  let errCode, errMessage

  if (err.errors) {
    // mongoose validation error
    errCode = 400 // bad request
    const keys = Object.keys(err.errors)
    // report the first validation error
    errMessage = err.errors[keys[0]].message
  } else {
    // generic or custom error
    errCode = err.status || 500
    errMessage = err.message || 'Internal Server Error'
  }
  res.status(errCode).type('txt')
    .send(errMessage)
})

// Basic Configuration
const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port)
})

// Set up DB
const Schema = mongoose.Schema;
const activitySchema = new Schema({
  description: { type: String, required: true },
  duration: { type: Number, required: true },
  date: Date
});
const userSchema = new Schema({
  username: { type: String, required: true },
  activities: [activitySchema]
});
let User = mongoose.model('User', userSchema);
console.log(User);

// Create a New User
app.post("/api/exercise/new-user", (req, res) => {
  let uname = req.body.username;
  console.log(`req.body.username: ${req.body.username}`);
  User.findOne({ username: uname }, (err, userFound) => {
    if (err) return console.error(err);
    //console.log(`typeof(userFound): ${typeof(userFound)}`);
    //console.log(`(userFound): ${(userFound)}`); //=null
    if (userFound == null) { // new username to be saved
      let newUser = new User({
        username: uname
      });
      newUser.save((err) => { if (err) return console.error(err); });
      res.json({ username: newUser.username, _id: newUser._id })
    } else { // duplicated username
      console.log(`userFound.username: ${userFound.username}`); //beter delete this one to avoid leakage of existing user names
      res.send("Username already taken");
    }
  })
})

// View user list
app.get("/api/exercise/users", (req, res)=>{
  async function showList(){
    let list = await User.aggregate([
      {
        $project: {
          "username": 1,
          "_id": 1
        }
      }
    ]);
    res.send(list);
  }
  showList(res).then(console.log("showList loaded"));
})

// Submit exercise activities
app.post("/api/exercise/add", (req, res) => {
  console.log(`req.body.userId: ${req.body.userId}`)
  let inputDate = req.body.date;
  if (inputDate==""){
    console.log(`inputDate is ''`);
    inputDate = new Date();
  } else if (inputDate==null){
    console.log(`inputDate is null`);
    inputDate = new Date();
  } else if (inputDate==undefined){
    console.log(`inputDate is undefined`);
    inputDate = new Date();
  } else {
    inputDate = new Date(req.body.date);
  }
  console.log(`req.body.date: ${req.body.date}`)
  User.findById(
    { _id: req.body.userId },
    (err, userFound) => {
      if (err) {
        console.error(err);
        res.send(err);
      };
      if (userFound == null) {
        res.send("User id does not exist");
      } else {
        userFound.activities.push({
          description: req.body.description,
          duration: req.body.duration*1,
          date: inputDate
        });
        userFound.save((err) => {
          if (err) return console.error(err);
        });
        console.log(userFound.activities);
        res.json({
          _id: userFound._id,
          username: userFound.username,
          description: req.body.description,
          duration: req.body.duration*1,
          date: inputDate.toDateString()
        });
      }
    }
  )
})

// Retreive query from url
console.log("fact check")
console.log(new Date('2020-11-24') > new Date('2020-11-31'))
app.get("/api/exercise/log", (req, res) => {
  console.log("outer level, req.query:")
  console.log(req.query);

  /** Using aggregation */
  showLog(req.query, res).then(console.log("Log shown"))
    .catch(err => console.log(err))

})

async function showLog(url, res) {
  console.log(`inside showLog, url: `);
  console.log(url);

  let userId = new mongoose.Types.ObjectId(url.userId),
    from = (url.from),
    to = (url.to),
    limit = url.limit

  if (url.from==null) {from = new Date(0)} else {from = new Date(url.from)}
  if (url.to==null) {to = new Date(8640000000000000)} else {to = new Date(url.to)}
  console.log(`from, to: `)
  console.log(from, to);

  let pipeline2 = [
    { $match: { "_id": userId } },
    { $unwind: "$activities" },
    { $project: {"activities._id":0} },
    { $sort: { "activities.date": -1 } },
    { 
      $match: {
        "activities.date": {
          $gte: from,
          $lte: to
        }
      }
    },
    {
      $group: {
        "_id": "$_id",
        "username": { "$first": "$username" },
        "count": { $sum: 1 },
        "log": { "$push": "$activities" }
      }
    },
    {
      $project: {
        "_id": 1,
        "username": 1,
        "log": {
          "$slice": ["$log", {
              "$cond": {
                if: { $and: [limit] },
                then: limit * 1,
                else: { "$size": "$log" }
              }
          }],
        }
      }
    },
    { $unwind: "$log" },
    {
      $group: {
        "_id": "$_id",
        "username": { "$first": "$username" },
        "count": { "$sum": 1 },
        "log": { "$push": "$log" }
      }
    }
  ]

  let logging = await User.aggregate(pipeline2)
    .then(console.log("inside showLog, pipeline ended"), err => console.log(err))

  console.log(`url.userId: ${url.userId}`);
  console.log(logging);
  res.json(logging[0]);
}
