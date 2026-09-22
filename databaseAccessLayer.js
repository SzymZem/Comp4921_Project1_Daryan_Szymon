const database = include('/databaseConnection');
const bcrypt = require('bcrypt');

async function getAllUsers() {
	let sqlQuery = `
		SELECT web_user_id, first_name, last_name, email
		FROM web_user;
	`;
	
	try {
		const results = await database.query(sqlQuery);
		console.log(results[0]);
		return results[0];
	}
	catch (err) {
		console.log("Error selecting from todo table");
		console.log(err);
		return null;
	}
}

async function addUser(postData) {
    let sqlInsert = `
		INSERT INTO web_user (first_name, last_name, email, password_hash) 
		VALUES (:first_name, :last_name, :email, :password_hash);
	`;
	let passwordHash = bcrypt.hashSync(postData.password, 12);
    let params = {    
            first_name: postData.first_name,
            last_name: postData.last_name,
            email: postData.email,
			password_hash: passwordHash
        };
    console.log(sqlInsert);
	try {
		const results = await database.query(sqlInsert, params);
		console.log({results});
		console.log(`Inserted new row with id: ${results[0].insertId}`);

		return true;
	}
	catch (err) {
		console.log(err);
		
		return false;
	}
}

async function deleteUser(webUserId) {
    let sqlDeleteUser = `
		DELETE FROM web_user WHERE web_user_id = :userID
	`;
	
    let params = {
        userID: webUserId
    };
    console.log(sqlDeleteUser);
	try {
		await database.query(sqlDeleteUser, params);
		return true;
	}
	catch (err) {
		console.log(err);
		return false;
	}        
}



module.exports = {getAllUsers, addUser, deleteUser}
