const path = require("path");
const express = require("express");
const app = express();
app.use(express.json());
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBandServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server is running at http://localhost:3000/");
    });
  } catch (error) {
    console.log(`DB Error: '${error.message}'`);
    process.exit(1);
  }
};

initializeDBandServer();

let validPassword = (password) => {
  return password.length > 6;
};

//API 1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const selectUser = `
    SELECT 
      username,password 
    FROM 
      user 
    WHERE 
      username='${username}';`;
  const dbUser = await db.get(selectUser);

  if (dbUser === undefined) {
    //SCENARIO 1
    const postUserDetails = `
            INSERT INTO 
            user
            (username,password,name,gender)
            VALUES
            ('${username}','${hashedPassword}','${name}','${gender}');`;

    // const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (validPassword(password) === true) {
      // SCENARIO 1
      await db.run(postUserDetails);
      response.status(200);
      response.send("User created successfully");
    } else {
      // SCENARIO 2
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    //   SCENARIO 3
    response.status(400);
    response.send("User already exists");
  }
});

const convertTweetJson = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};

const tweetStats = (dbObject) => {
  return {
    tweet: dbObject.tweet,
    likes: dbObject.likes,
    replies: dbObject.replies,
    dateTime: dbObject.date_time,
  };
};

//API 2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUser = `
      SELECT 
        * 
      FROM 
        user 
      WHERE 
        username='${username}';`;
  const dbUser = await db.get(selectUser);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const comparePassword = await bcrypt.compare(password, dbUser.password);
    if (comparePassword === true) {
      const payload = {
        username: username,
      };
      const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//AUTHENTICATION

const middlewareFunction = (request, response, next) => {
  let jwtToken;
  const authorizationHeader = request.headers["authorization"];
  if (authorizationHeader !== undefined) {
    jwtToken = authorizationHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

const getUser = async (username) => {
  const userQuery = `
  SELECT 
    user_id 
    FROM 
      user
    WHERE username='${username}';`;
  const userId = await db.get(userQuery);
  return userId.user_id;
};

//API 3
app.get("/user/tweets/feed/", middlewareFunction, async (request, response) => {
  const { username } = request;
  const userId = await getUser(username);
  //   const follower_user_id = request["user_id"];
  const getUserQuery = `
    SELECT 
      DISTINCT username,tweet,date_time AS dateTime
    FROM 
      user
    INNER JOIN tweet ON tweet.user_id=user.user_id
    INNER JOIN follower ON follower.follower_user_id=user.user_id
    WHERE follower.follower_user_id=${userId}
    ORDER BY user.user_id ASC
      LIMIT 4;`;
  const getTweets = await db.all(getUserQuery);
  response.send(getTweets.map((tweet) => convertTweetJson(tweet)));
});

//API 4
app.get("/user/following/", middlewareFunction, async (request, response) => {
  const { username } = request;
  const userId = await getUser(username);
  //   const following_user_id = request;
  const getNames = `
    SELECT
      name
    FROM
      user
    INNER JOIN follower ON user.user_id = follower.following_user_id
    WHERE follower.follower_user_id=${userId};`;
  const getUserNames = await db.all(getNames);
  response.send(getUserNames);
});

// API 5
app.get("/user/followers/", middlewareFunction, async (request, response) => {
  const { username } = request;
  const userId = await getUser(username);
  const getNames = `
    SELECT
     DISTINCT name
    FROM 
      follower
    INNER JOIN 
      user ON 
    follower.follower_user_id=${userId};`;
  const getUserNames = await db.all(getNames);
  response.send(getUserNames);
});

//API 6  //SUB QUERY
app.get("/tweets/:tweetId/", middlewareFunction, async (request, response) => {
  const { tweet_id } = request.params;
  const follower_user_id = request["user_id"];
  const getFollowingUser = `
    SELECT 
      tweet,COUNT(like_id) AS likes,
      COUNT(reply) AS replies,
      date_time AS dateTime

    FROM
      tweet  
    INNER JOIN like ON like.user_id=tweet.user_id
    INNER JOIN reply ON reply.user_id=tweet.user_id
    INNER JOIN follower ON follower.follower_user_id = tweet.user_id
    INNER JOIN user ON user.user_id=follower.follower_user_id;`;
  const getTwitterFollowers = await db.all(getFollowingUser);
  const tweet = db.get(getFollowingUser);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    response.send(getTwitterFollowers);
  }
});

//API 7
app.get(
  "/tweets/:tweetId/likes/",
  middlewareFunction,
  async (request, response, next) => {
    const { tweet_id } = request.params;
    const username = request;
    const getFollowingUser = `
    SELECT 
       DISTINCT(username)
    FROM 
       user INNER JOIN tweet ON tweet.user_id=user.user_id;`;
    const getFollowingTweet = await db.all(getFollowingUser);
    //   response.send(getFollowingUser);
    const data = getFollowingTweet.map((each) => each.username);
    if (getFollowingTweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      response.send({ likes: data });
    }
  }
);

// API 8
app.get(
  "/tweets/:tweetId/replies/",
  middlewareFunction,
  async (request, response) => {
    const { tweetId } = request.params;
    const { username } = request;
    const userId = await getUser(username);
    const getTweet = `
    SELECT 
      * 
    FROM 
      tweet 
    INNER JOIN follower ON tweet.user_id=follower.following_user_id
    WHERE 
      tweet_id=${tweetId} AND follower_user_id=${userId};`;
    const tweetReply = await db.get(getTweet);
    if (tweetReply === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getReply = `
      SELECT 
        user.name,
        reply.reply
  FROM 
   ( tweet 
  INNER JOIN 
    reply ON tweet.tweet_id=reply.tweet_id)
  INNER JOIN 
    user ON user.user_id=reply.user_id
  WHERE
    tweet.tweet_id=${tweetId};`;
      const replyCount = await db.all(getReply);
      const responseQuery = { replies: replyCount };
      response.send(responseQuery);
    }

    //     const follower_user_id = request["userId"];
    //     const getUserReply = `
    //   SELECT
    //     user.name,reply.reply
    //   FROM
    //     user
    //   INNER JOIN
    //     tweet ON tweet.user_id=user.user_id
    //   JOIN
    //     reply ON reply.tweet_id=tweet.tweet_id
    //   JOIN
    //     follower ON follower.follower_user_id=user.user_id

    //   WHERE
    //     reply.user_id=user.user_id;`;
    //     const getReplies = await db.all(getUserReply);
    //     // response.send({ replies: getReplies });
    //     if (getUserReply.length === 0) {
    //       response.send("Invalid Request");
    //       response.status(401);
    //     } else {
    //       response.send({ replies: getReplies });
    //     }
  }
);

// API 9

app.get("/user/tweets/", middlewareFunction, async (request, response) => {
  const { username } = request;
  const userId = await getUser(username);
  const getUserTweets = `
  SELECT 
    tweet,
    COUNT(*) AS likes,
   (SELECT COUNT(*) AS replies
  FROM 
    tweet 
   INNER JOIN 
     reply ON tweet.tweet_id=reply.tweet_id
   WHERE tweet.user_id=${userId}
   GROUP BY tweet.tweet_id) AS replies,tweet.date_time
   FROM tweet
   INNER JOIN like ON tweet.tweet_id=like.tweet_id
   WHERE tweet.user_id=${userId}
   GROUP BY tweet.tweet_id;`;
  const userTweets = await db.all(getUserTweets);
  response.send(userTweets.map((tweet) => tweetStats(tweet)));
});

// API 10
app.post(
  "/user/tweets/",
  middlewareFunction,
  async (request, response, next) => {
    const { username } = request;
    const userId = await getUser(username);
    const { tweet } = request.body;
    const createTweet = `
        INSERT INTO
           tweet    
        (tweet,user_id)
        VALUES
           ('${tweet}','${userId}');`;
    await db.run(createTweet);
    response.status(200);
    response.send("Created a Tweet");
  }
);

// API 11

app.delete(
  "/tweets/:tweetId/",
  middlewareFunction,
  async (request, response) => {
    const { username } = request;
    const userId = await getUser(username);
    const { tweetId } = request.params;

    const getTweetQuery = `
       SELECT
         *
       FROM
         tweet
       WHERE tweet_id='${tweetId}';`;
    const tweet = await db.get(getTweetQuery);
    const { user_id } = tweet;
    if (user_id === userId) {
      const deleteTweet = `
    DELETE
    FROM
      tweet
    WHERE tweet_id=${tweetId}
      AND
    tweet_id=${tweetId};`;
      await db.run(deleteTweet);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

// app.delete(
//   "/tweets/:tweetId/",
//   middlewareFunction,
//   async (request, response) => {
//     const { tweetId } = request.params;
//     const user_id = request["userId"];
//     const getTweetQuery = `SELECT * FROM tweet
//     WHERE user_id=${user_id} and tweet_id=${tweetId};`;

//     const data = await db.get(getTweetQuery);

//     if (data === undefined) {
//       response.status(401);
//       response.send("Invalid Request");
//     } else {
//       const deleteTweetQuery = `DELETE FROM tweet
//     WHERE user_id=${user_id} and tweet_id=${tweetId};`;

//       await db.run(deleteTweetQuery);
//       response.send("Tweet Removed");
//     }
//   }
// );

module.exports = app;
