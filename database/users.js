const database = require('../databaseConnection');
async function createUser(postData) {
	let createUserSQL = `
		INSERT INTO user
		(username, password_hash)
		VALUES
		(?, ?);
	`;

	let params = [
		postData.user,
		postData.hashedPassword
	];

	try {
		const results = await database.query(createUserSQL, params);

		console.log("Successfully created user");
		console.log(results[0]);
		return true;
	}
	catch (err) {
		console.log("Error inserting user");
		console.log(err);
		return false;
	}
	finally {
		console.log("----- INPUTTED SQL: -----\n" + createUserSQL)
	}
}

async function getUsers() {
	let getUsersSQL = `
		SELECT username, password_hash
		FROM user;
	`;

	try {
		const results = await database.query(getUsersSQL);

		console.log("Successfully retrieved users");
		console.log(results[0]);
		return results[0];
	}
	catch (err) {
		console.log("Error getting users");
		console.log(err);
		return false;
	}
}

async function getUser(postData) {
	let getUserSQL = `
		SELECT user_id, username, password_hash
		FROM user
		WHERE username = ?;
	`;

	let params = [
		postData.user
	];

	try {
		const results = await database.query(getUserSQL, params);

		console.log("Successfully found user");
		console.log(results[0]);
		return results[0];
	}
	catch (err) {
		console.log("Error trying to find user");
		console.log(err);
		return false;
	}
}


async function getAllUsers() {
	const sql = `SELECT user_id, username FROM user`;
	const [rows] = await database.query(sql);
	return rows;
}

async function createGroup(name) {
	const sql = `INSERT INTO room (name) VALUES (?)`;
	const [result] = await database.query(sql, [name]);
	return result.insertId;
}

async function addUserToGroup(userId, roomId) {
	const sql = `
		INSERT IGNORE INTO room_user (user_id, room_id)
		VALUES (?, ?)
    `;
	await database.query(sql, [userId, roomId]);
}

async function getUserGroups(userId) {
	const sql = `
        SELECT 
            r.room_id,
            r.name,

            MAX(m.sent_datetime) AS last_message_time,

            SUM(
                CASE 
                    WHEN m.message_id > IFNULL(ru.last_read_message_id, 0) 
                    THEN 1 
                    ELSE 0 
                END
            ) AS unread_count

        FROM room r
        JOIN room_user ru ON r.room_id = ru.room_id

        LEFT JOIN message m 
            ON m.room_user_id IN (
                SELECT room_user_id 
                FROM room_user 
                WHERE room_id = r.room_id
            )

        WHERE ru.user_id = ?

        GROUP BY r.room_id, r.name

        ORDER BY last_message_time DESC
    `;

	const [rows] = await database.query(sql, [userId]);
	return rows;
}

async function getGroup(roomId) {
	const sql = `
        SELECT room_id, name
        FROM room
        WHERE room_id = ?
    `;
	const [rows] = await database.query(sql, [roomId]);
	return rows[0];
}

async function getGroupMembers(roomId) {
	const sql = `
        SELECT u.user_id, u.username
        FROM user u
        JOIN room_user ru ON u.user_id = ru.user_id
        WHERE ru.room_id = ?
    `;
	const [rows] = await database.query(sql, [roomId]);
	return rows;
}

async function getMessages(userId, roomId) {
	const sql = `
		SELECT 
			m.message_id,
			m.text,
			m.sent_datetime,
			u.username,
			e.emoji_id,
			e.name AS emoji_name,
			e.image AS emoji_image,
			COUNT(r.reaction_id) AS reaction_count,
			MAX(CASE WHEN r.user_id = ? THEN 1 ELSE 0 END) AS reacted
		FROM message m
		JOIN room_user ru ON m.room_user_id = ru.room_user_id
		JOIN user u ON ru.user_id = u.user_id
		LEFT JOIN reaction r ON m.message_id = r.message_id
		LEFT JOIN emoji e ON r.emoji_id = e.emoji_id
		WHERE ru.room_id = ?
		GROUP BY m.message_id, e.emoji_id
		ORDER BY m.sent_datetime ASC
    `;

	const [rows] = await database.query(sql, [userId, roomId]);

	const grouped = {};

	for (const row of rows) {
		if (!grouped[row.message_id]) {
			grouped[row.message_id] = {
				message_id: row.message_id,
				text: row.text,
				sent_datetime: row.sent_datetime,
				username: row.username,
				reactions: []
			};
		}

		if (row.emoji_name) {
			grouped[row.message_id].reactions.push({
				emoji_id: row.emoji_id,
				name: row.emoji_name,
				image: row.emoji_image,
				count: row.reaction_count,
				reacted: row.reacted === 1
			});
		}
	}

	return Object.values(grouped);
}

async function createMessage(userId, roomId, text) {

	const sqlFind = `
        SELECT room_user_id
        FROM room_user
        WHERE user_id = ? AND room_id = ?
    `;

	const [rows] = await database.query(sqlFind, [userId, roomId]);

	if (rows.length === 0) {
		return null;
	}

	const roomUserId = rows[0].room_user_id;

	const sqlInsert = `
        INSERT INTO message (room_user_id, sent_datetime, text)
        VALUES (?, NOW(), ?)
    `;

	const [result] = await database.query(sqlInsert, [roomUserId, text]);
	return result.insertId;
}

async function isUserInGroup(userId, roomId) {
	const sql = `
        SELECT 1
        FROM room_user
        WHERE user_id = ? AND room_id = ?
    `;

	const [rows] = await database.query(sql, [userId, roomId]);
	return rows.length > 0;
}

async function getReactions(messageId) {
	const sql = `
        SELECT e.emoji_id, e.name, COUNT(*) as count
        FROM reaction r
        JOIN emoji e ON r.emoji_id = e.emoji_id
        WHERE r.message_id = ?
        GROUP BY e.emoji_id, e.name
    `;

	const [rows] = await database.query(sql, [messageId]);
	return rows;
}

async function addReaction(messageId, emojiId, userId) {
	const sql = `
        INSERT IGNORE INTO reaction (message_id, emoji_id, user_id)
        VALUES (?, ?, ?)
    `;

	await database.query(sql, [messageId, emojiId, userId]);
}

async function getEmojis() {
	const sql = `SELECT emoji_id, name, image FROM emoji`;
	const [rows] = await database.query(sql);
	return rows;
}

async function removeReaction(messageId, emojiId, userId) {
	const sql = `
        DELETE FROM reaction
        WHERE message_id = ? AND emoji_id = ? AND user_id = ?
    `;
	await database.query(sql, [messageId, emojiId, userId]);
}

async function getLastReadMessage(userId, roomId) {
	const sql = `
        SELECT last_read_message_id
        FROM room_user
        WHERE user_id = ? AND room_id = ?
    `;

	const [rows] = await database.query(sql, [userId, roomId]);

	if (rows.length === 0) {
		return null;
	}

	return rows[0].last_read_message_id;
}

async function updateLastReadMessage(userId, roomId, messageId) {
	const sql = `
        UPDATE room_user
        SET last_read_message_id = ?
        WHERE user_id = ? AND room_id = ?
    `;

	await database.query(sql, [messageId, userId, roomId]);
}

async function updateGroupName(roomId, name)
{
    const sql = `
        UPDATE room
        SET name = ?
        WHERE room_id = ?
    `;
    await database.query(sql, [name, roomId]);
}

async function clearGroupUsers(roomId)
{
    const sql = `
        DELETE FROM room_user
        WHERE room_id = ?
    `;
    await database.query(sql, [roomId]);
}

async function removeUserFromGroup(userId, roomId)
{
    const sql = `
        DELETE FROM room_user
        WHERE user_id = ? AND room_id = ?
    `;
    await database.query(sql, [userId, roomId]);
}

module.exports = {
	createUser,
	getUsers,
	getUser,
	getAllUsers,
	createGroup,
	addUserToGroup,
	getUserGroups,
	getGroup,
	getGroupMembers,
	getMessages,
	createMessage,
	isUserInGroup,
	getReactions,
	addReaction,
	getEmojis,
	removeReaction,
	getLastReadMessage,
	updateLastReadMessage,
	updateGroupName,
	clearGroupUsers,
	removeUserFromGroup
};