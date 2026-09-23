require('./utils');

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const saltRounds = 12;


const database = require('./databaseConnection');
const db_utils = require('./database/db_utils');
const db_users = require('./database/users');
const db_content = require('./database/content');
const success = db_utils.printMySQLVersion();

const port = process.env.PORT || 3000;

const app = express();
app.set('trust proxy', 1);
const expireTime = 60 * 60 * 1000; //expires after 1 hour  (minutes * seconds * millis)


/* secret information section */
const mongodb_user = process.env.MONGODB_USER;
const mongodb_password = process.env.MONGODB_PASSWORD;
const mongodb_session_secret = process.env.MONGODB_SESSION_SECRET;

const node_session_secret = process.env.NODE_SESSION_SECRET;
/* END secret section */

app.set('view engine', 'ejs');

app.use(express.urlencoded({ extended: false }));

const mongoStore = MongoStore.create({
    mongoUrl: process.env.MONGODB_URL,
});




app.use(session({
    secret: node_session_secret,
    store: mongoStore,
    saveUninitialized: false,
    resave: false,
    cookie: {
        maxAge: expireTime,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
}));

// must come after session() so req.session exists
app.use((req, res, next) => {
    res.locals.loggedIn = req.session?.authenticated === true;
    res.locals.username = req.session?.username || null;
    next();
});


app.get('/', (req, res) => {

    // send logged in/session info to index page
    res.render("index", {
        loggedIn: req.session.authenticated === true,
        username: req.session.username
    });
});


app.get('/about', (req, res) => {
    var color = req.query.color;
    if (!color) {
        color = "black";
    }

    res.render("about", { color: color });
});

app.get('/contact', (req, res) => {
    var missingEmail = req.query.missing;
    res.render("contact", { missing: missingEmail });
});

app.post('/submitEmail', (req, res) => {
    var email = req.body.email;
    if (!email) {
        res.redirect('/contact?missing=1');
    }
    else {
        res.render("submitEmail", { email: email });
    }
});

app.get('/createTables', async (req, res) => {

    const create_tables = require('./database/create_tables');

    let success = await create_tables.createTables();
    if (success) {
        res.render("successMessage", { message: "Created tables." });
    }
    else {
        res.render("errorMessage", { error: "Failed to create tables." });
    }
});

app.get('/signup', (req, res) => {
    res.render("signup", {
        error: undefined,
        username: ""
    });
});

async function renderMembers(req, res, error, form) {
    const groups = await db_users.getUserGroups(req.session.user_id);
    const links = await db_content.getUserContent(req.session.user_id);

    res.render('members', {
        loggedIn: true,
        username: req.session.username,
        groups: groups,
        links: links,
        baseUrl: req.protocol + '://' + req.get('host'),
        error: error || null,
        form: form || { url: "", customCode: "" }
    });
}

app.get('/members', async (req, res) => {

    if (!req.session.authenticated) {
        res.redirect('/');
        return
    }

    await renderMembers(req, res);
});


app.get('/login', (req, res) => {
    res.render("login");
});

app.post('/submitUser', async (req, res) => {
    var username = req.body.username;
    var password = req.body.password;

    const passwordValid = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{10,}$/.test(password);

    if (passwordValid && username.trim().length > 0) {
        var hashedPassword = bcrypt.hashSync(password, saltRounds);

        var success = await db_users.createUser({ user: username, hashedPassword: hashedPassword });

        if (success) {
            var results = await db_users.getUsers();

            res.render("submitUser", { users: results });
        }
        else {
            res.render("errorMessage", { error: "Failed to create user." });
        }

    }
    else {
        res.render("signup", {
            error: "Password must be 10+ chars with upper, lower, number, symbol. ",
            username: username ?? ""
        });
    }
});

app.post('/loggingin', async (req, res) => {
    var username = req.body.username;
    var password = req.body.password;


    var results = await db_users.getUser({ user: username });


    console.log("RAW INPUT:", password);
    console.log("INPUT LENGTH:", password.length);

    if (results.length === 0) {
        console.log("User not found");
        res.redirect('/login');
        return;
    }

    console.log("HASH:", results[0].password_hash);

    if (results) {
        if (results.length == 1) { //there should only be 1 user in the db that matches
            if (bcrypt.compareSync(password, results[0].password_hash)) {
                req.session.authenticated = true;
                req.session.user_type = 'member';
                req.session.username = username;
                req.session.user_id = results[0].user_id;
                req.session.cookie.maxAge = expireTime;

                req.session.save(() => {
                    res.redirect('/members');
                });

                return;
            }
            else {
                console.log("invalid password");
            }
        }
        else {
            console.log('invalid number of users matched: ' + results.length + " (expected 1).");
            res.redirect('/');
            return;
        }
    }

    console.log('user not found');
    //user and password combination not found
    res.redirect("/login");
});


app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.log(err);
            res.render("errorMessage", { error: "failed to log out" });
            return;
        }

        res.clearCookie('connect.sid'); // default cookie name for express-session
        res.redirect('/');
    });

    console.log('user logged out')
});


function isValidSession(req) {
    if (req.session.authenticated) {
        return true;
    }
    return false;
}

function sessionValidation(req, res, next) {
    if (!isValidSession(req)) {
        req.session.destroy();
        res.redirect('/');
        return;
    }
    else {
        next();
    }
}

function isAdmin(req) {
    if (req.session.user_type == 'admin') {
        return true;
    }
    return false;
}

function adminAuthorization(req, res, next) {
    if (!isAdmin(req)) {
        res.status(403);
        res.render("errorMessage", { error: "Not Authorized" });
        return;
    }
    else {
        next();
    }
}

app.use('/loggedin', sessionValidation);
app.use('/loggedin/admin', adminAuthorization);

app.get('/loggedin', (req, res) => {
    res.render("loggedin");
});

app.get('/loggedin/info', (req, res) => {
    res.render("loggedin-info");
});

app.get('/loggedin/admin', (req, res) => {
    res.render("admin");
});

app.get('/loggedin/memberinfo', (req, res) => {
    res.render("memberInfo", { username: req.session.username, user_type: req.session.user_type });
});


app.get('/api', (req, res) => {
    var user = req.session.user;
    var user_type = req.session.user_type;
    console.log("api hit ");

    var jsonResponse = {
        success: false,
        data: null,
        date: new Date()
    };


    if (!isValidSession(req)) {
        jsonResponse.success = false;
        res.status(401);  //401 == bad user
        res.json(jsonResponse);
        return;
    }

    if (typeof id === 'undefined') {
        jsonResponse.success = true;
        if (user_type === "admin") {
            jsonResponse.data = ["A", "B", "C", "D"];
        }
        else {
            jsonResponse.data = ["A", "B"];
        }
    }
    else {
        if (!isAdmin(req)) {
            jsonResponse.success = false;
            res.status(403);  //403 == good user, but, user should not have access
            res.json(jsonResponse);
            return;
        }
        jsonResponse.success = true;
        jsonResponse.data = [id + " - details"];
    }

    res.json(jsonResponse);

});

app.use('/links', sessionValidation);

app.post('/links/create', async (req, res) => {
    const form = {
        url: (req.body.url || "").trim(),
        customCode: (req.body.customCode || "").trim()
    };

    const url = db_content.normalizeUrl(form.url);
    if (!url) {
        res.status(400);
        await renderMembers(req, res, "Please enter a valid http(s) URL.", form);
        return;
    }

    if (form.customCode && !db_content.isValidCustomCode(form.customCode)) {
        res.status(400);
        await renderMembers(req, res, "Custom short URL must be 3-32 letters, numbers, - or _ and not a reserved word.", form);
        return;
    }

    const result = await db_content.createLink(req.session.user_id, url, form.customCode);
    if (!result.success) {
        res.status(400);
        await renderMembers(req, res, result.error, form);
        return;
    }

    res.redirect('/members');
});

app.post('/links/:id/toggle', async (req, res) => {
    const updated = await db_content.toggleActive(req.params.id, req.session.user_id);
    if (!updated) {
        res.status(400).render("errorMessage", { error: "You can only edit your own links." });
        return;
    }
    res.redirect('/members');
});

app.post('/links/:id/delete', async (req, res) => {
    const deleted = await db_content.deleteContent(req.params.id, req.session.user_id);
    if (!deleted) {
        res.status(400).render("errorMessage", { error: "You can only delete your own links." });
        return;
    }
    res.redirect('/members');
});

app.get('/createGroup', async (req, res) => {

    const users = await db_users.getAllUsers();

    res.render('createGroup', {
        users: users
    });
});

app.post('/createGroup', async (req, res) => {

    const groupName = req.body.groupName;
    let userIds = req.body.userIds || [];

    if (!Array.isArray(userIds)) {
        userIds = [userIds];
    }

    const roomId = await db_users.createGroup(groupName);

    let allUserIds = new Set(userIds.map(id => parseInt(id)));
    allUserIds.add(req.session.user_id);

    for (let userId of allUserIds) {
        await db_users.addUserToGroup(userId, roomId);
    }

    res.redirect('/members');
});

app.get('/group/:id', async (req, res) => {

    if (!req.session.authenticated) {
        res.redirect('/');
        return;
    }

    const roomId = req.params.id;
    const userId = req.session.user_id;

    const isMember = await db_users.isUserInGroup(userId, roomId);

    if (!isMember) {
        res.status(403);
        res.render("errorMessage", { error: "You are not in this group!!!" });
        return;
    }

    const group = await db_users.getGroup(roomId);
    const members = await db_users.getGroupMembers(roomId);
    const messages = await db_users.getMessages(req.session.user_id, roomId);
    const emojis = await db_users.getEmojis();

    res.render('group', {
        group: group,
        members: members,
        messages: messages,
        currentUser: req.session.username,
        emojis: emojis
    });
});

app.post('/group/:id/send', async (req, res) => {

    const roomId = req.params.id;
    const text = req.body.message;

    if (!text || text.trim().length === 0) {
        res.redirect(`/group/${roomId}`);
        return;
    }

    const messageId = await db_users.createMessage(req.session.user_id, roomId, text);

    if (messageId) {
        await db_users.updateLastReadMessage(req.session.user_id, roomId, messageId);
    }

    res.redirect(`/group/${roomId}`);
});

app.get('/group/:id/messages', async (req, res) => {

    const roomId = req.params.id;
    const userId = req.session.user_id;

    const isMember = await db_users.isUserInGroup(userId, roomId);

    if (!isMember) {
        res.status(403).json({ error: "Not authorized" });
        return;
    }

    const messages = await db_users.getMessages(userId, roomId);
    const lastRead = await db_users.getLastReadMessage(userId, roomId);

    res.json({
        messages: messages,
        lastRead: lastRead
    });
});

app.get('/group/:id/edit', async (req, res) => {

    const roomId = req.params.id;
    const userId = req.session.user_id;

    const isMember = await db_users.isUserInGroup(userId, roomId);

    if (!isMember) {
        res.status(403).render("errorMessage", { error: "Not authorized" });
        return;
    }

    const group = await db_users.getGroup(roomId);
    const members = await db_users.getGroupMembers(roomId);
    const users = await db_users.getAllUsers();

    res.render('editGroup', {
        group,
        members,
        users
    });
});

app.post('/group/:id/edit', async (req, res) => {

    const roomId = req.params.id;
    const groupName = req.body.groupName;
    let userIds = req.body.userIds || [];

    if (!Array.isArray(userIds)) {
        userIds = [userIds];
    }

    userIds = userIds.map(id => parseInt(id));

    //  update group name
    await db_users.updateGroupName(roomId, groupName);

    // get current members
    const currentMembers = await db_users.getGroupMembers(roomId);
    const currentIds = currentMembers.map(u => u.user_id);

    // users to remove
    for (const id of currentIds) {
        if (!userIds.includes(id)) {
            await db_users.removeUserFromGroup(id, roomId);
        }
    }

    // users to add  
    for (const id of userIds) {
        if (!currentIds.includes(id)) {
            await db_users.addUserToGroup(id, roomId);
        }
    }
    // add selected users
    for (const userId of userIds) {
        await db_users.addUserToGroup(userId, roomId);
    }

    res.redirect(`/group/${roomId}`);
});

app.get('/message/:id/reactions', async (req, res) => {

    const messageId = req.params.id;

    const reactions = await db_users.getReactions(messageId);

    res.json(reactions);
});

app.post('/message/:id/react', async (req, res) => {

    const messageId = req.params.id;
    const emojiId = req.body.emojiId;
    const userId = req.session.user_id;

    await db_users.addReaction(messageId, emojiId, userId);

    res.json({ success: true });
});

app.post('/message/:id/unreact', async (req, res) => {

    const messageId = req.params.id;
    const emojiId = req.body.emojiId;
    const userId = req.session.user_id;

    await db_users.removeReaction(messageId, emojiId, userId);

    res.json({ success: true });
});

app.post('/group/:id/read', async (req, res) => {

    const roomId = req.params.id;
    const userId = req.session.user_id;
    const messageId = parseInt(req.body.messageId);

    const isMember = await db_users.isUserInGroup(userId, roomId);

    if (!isMember) {
        res.status(403).json({ error: "Not authorized" });
        return;
    }

    if (!messageId) {
        res.status(400).json({ error: "Missing messageId" });
        return;
    }

    const currentLastRead = await db_users.getLastReadMessage(userId, roomId);

    if (currentLastRead == null || messageId > currentLastRead) {
        await db_users.updateLastReadMessage(userId, roomId, messageId);
    }

    res.json({ success: true });
});

app.use(express.static(__dirname + "/public"));

// Short links live at the root, so this must stay after every other route and
// the static files. Viewing doesn't require login.
app.get('/:code', async (req, res, next) => {
    const content = await db_content.getContent(req.params.code);
    if (!content) {
        next(); // falls through to the 404 page
        return;
    }

    if (!content.active) {
        res.status(410).render("unavailable");
        return;
    }

    await db_content.recordHit(content.content_id);

    if (content.content_type === 'link') {
        // 302 (not 301) so browsers don't cache the redirect and skip our hit counter
        res.redirect(302, content.data);
        return;
    }

    next();
});

app.get("*", (req, res) => {
    res.status(404);
    res.render("404");
})

if (require.main === module) {
    app.listen(port, () => {
        console.log("Node application listening on port " + port);
    });
}

module.exports = app;



