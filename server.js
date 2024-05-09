require('dotenv').config();
const bcrypt = require('bcrypt');
const express = require('express');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const methodOverride = require('method-override');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const uri = process.env.MONGO_URI;
const port = `${process.env.PORT}`;
const SECRET = process.env.SECRET_KEY;

const app = express();
const client = new MongoClient(uri);

app.set('view engine', 'ejs');
app.use(express.static('public'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadDir = 'public/uploads/';
app.use(methodOverride('_method'));

app.use(cookieParser());

app.use(async (req, res, next) => {
  const token = req.cookies.token;
  if (token) {
    try {
      const decodedData = jwt.verify(token, SECRET);
      const db = await getDB();
      const user = await db
        .collection('users')
        .findOne({ userid: decodedData.userid });
      req.user = user ? user : null;

      console.log(user);
    } catch (error) {
      console.error(error);
    }
  }
  next();
});
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const getDB = async () => {
  await client.connect();
  return client.db('blog');
};

app.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const posts = await db
      .collection('posts')
      .find()
      .sort({ createAtDate: -1 })
      .limit(6)
      .toArray();
    res.render('index', { posts, user: req.user });
  } catch (e) {
    console.error(e);
  }
});
app.get('/getPosts', async (req, res) => {
  const page = req.query.page || 1;
  const postsPerPage = 3;
  const skip = 3 + (page - 1) * postsPerPage;
  try {
    const db = await getDB();
    const posts = await db
      .collection('posts')
      .find()
      .sort({ createAtDate: -1 })
      .skip(skip)
      .limit(postsPerPage)
      .toArray();
    res.json(posts);
  } catch (error) {
    console.error(error);
  }
});

app.get('/write', (req, res) => {
  res.render('write', { user: req.user });
});
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage: storage });

app.post('/write', upload.single('postImg'), async (req, res) => {
  const { title, content } = req.body;
  const postImg = req.file ? req.file.filename : null;
  const createAtDate = new Date();
  try {
    let db = await getDB();
    const result = await db.collection('counter').findOne({ name: 'counter' });
    await db.collection('posts').insertOne({
      _id: result.totalPost + 1,
      title,
      content,
      createAtDate,
      userid: req.user.userid,
      username: req.user.username,
      postImgPath: postImg ? `/uploads/${postImg}` : null,
    });
    await db
      .collection('counter')
      .updateOne({ name: 'counter' }, { $inc: { totalPost: 1 } });
    await db.collection('like').insertOne({
      post_id: result.totalPost + 1,
      likeTotal: 0,
      likeMember: [],
    });
    res.redirect('/');
  } catch (error) {
    console.log(error);
  }
});
app.post('/comment/:id', async (req, res) => {
  const post_id = parseInt(req.params.id, 10);
  const { comment } = req.body;
  const createAtDate = new Date();
  try {
    const db = await getDB();
    await db.collection('comment').insertOne({
      post_id,
      comment,
      createAtDate,
      userid: req.user.userid,
      username: req.user.username,
    });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.json({ success: false });
  }
});
app.get('/detail/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const db = await getDB();
    const posts = await db.collection('posts').findOne({ _id: id });
    const like = await db.collection('like').findOne({ post_id: id });
    const comments = await db
      .collection('comment')
      .find({ post_id: id })
      .sort({ createAtDate: -1 })
      .toArray();
    res.render('detail', { posts, user: req.user, like, comments });
  } catch (e) {
    console.error(e);
  }
});
app.post('/delete/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const db = await getDB();
    await db.collection('posts').deleteOne({ _id: id });
    res.redirect('/');
  } catch (e) {
    console.error(e);
  }
});
app.get('/edit/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const db = await getDB();
    const posts = await db.collection('posts').findOne({ _id: id });
    res.render('edit', { posts, user: req.user });
  } catch (e) {
    console.error(e);
  }
});
app.post('/edit', upload.single('postImg'), async (req, res) => {
  console.log('-------------', req.body);
  const { id, title, content, createAtDate } = req.body;
  const postImgOld = req.body.postImgOld.replace('/uploads/', '');
  const postImg = req.file ? req.file.filename : postImgOld;
  try {
    const db = await getDB();
    await db.collection('posts').updateOne(
      { _id: parseInt(id, 10) },
      {
        $set: {
          title,
          content,
          createAtDate,
          postImgPath: postImg ? `/uploads/${postImg}` : null,
        },
      }
    );
    res.redirect('/');
  } catch (error) {
    console.error(error);
  }
});
app.get('/signup', (req, res) => {
  const user = req.user ? req.user : null;
  res.render('signup', { user });
});
const saltRounds = parseInt(process.env.SALT_ROUNDS, 10);
app.post('/signup', async (req, res) => {
  const { userid, pw, pw2, username } = req.body;
  try {
    const hashedPw = await bcrypt.hash(pw, saltRounds);
    const db = await getDB();
    await db.collection('users').insertOne({ userid, username, pw: hashedPw });
    res.redirect('/login');
  } catch (error) {
    console.error(error);
  }
});
app.get('/login', (req, res) => res.render('login', { user: req.user }));
app.post('/login', async (req, res) => {
  const { userid, pw } = req.body;
  try {
    const db = await getDB();
    const user = await db.collection('users').findOne({ userid });
    console.log('로그인 데이터 ----- ', user);
    if (user) {
      const compareResult = await bcrypt.compare(pw, user.pw);
      if (compareResult) {
        const token = jwt.sign({ userid: user.userid }, SECRET);
        res.cookie('token', token);
        res.redirect('/');
      } else {
        res.status(401).send();
      }
    } else {
      res.status(404).send();
    }
  } catch (error) {
    console.error(error);
  }
});
app.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});
app.get('/personal/:userid', async (req, res) => {
  const user = req.user ? req.user : null;
  const postUser = req.params.userid;
  try {
    const db = await getDB();
    const posts = await db
      .collection('posts')
      .find({ userid: postUser })
      .toArray();
    res.render('personal', { posts, user, postUser });
  } catch (error) {
    console.error(error);
  }
});
app.get('/mypage', async (req, res) => {
  console.log(req.user);
  res.render('mypage', { user: req.user });
});
app.post('/like/:id', async (req, res) => {
  const postid = parseInt(req.params.id, 10);
  const userid = req.user.userid;
  try {
    const db = await getDB();
    const like = await db.collection('like').findOne({ post_id: postid });

    if (like.likeMember.includes(userid)) {
      await db.collection('like').updateOne(
        { post_id: postid },
        {
          $inc: { likeTotal: -1 },
          $pull: { likeMember: userid },
        }
      );
    } else {
      await db.collection('like').updateOne(
        { post_id: postid },
        {
          $inc: { likeTotal: 1 },
          $push: { likeMember: userid },
        }
      );
    }

    res.redirect('/detail/' + postid);
  } catch (error) {
    console.error(error);
  }
});
app.listen(port, () => {
  console.log(`잘돌아감 --- ${port}`);
});
