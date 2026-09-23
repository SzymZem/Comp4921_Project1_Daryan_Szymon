const database = require('../databaseConnection');

async function createTables() {

    const dropContentSQL = `DROP TABLE IF EXISTS content;`;
    const dropReactionSQL = `DROP TABLE IF EXISTS reaction;`;
    const dropMessageSQL = `DROP TABLE IF EXISTS message;`;
    const dropRoomUserSQL = `DROP TABLE IF EXISTS room_user;`;
    const dropRoomSQL = `DROP TABLE IF EXISTS room;`;
    const dropEmojiSQL = `DROP TABLE IF EXISTS emoji;`;
    const dropUserSQL = `DROP TABLE IF EXISTS user;`;

    const createUserSQL = `
        CREATE TABLE IF NOT EXISTS user (
            user_id INT NOT NULL AUTO_INCREMENT,
            username VARCHAR(50) NOT NULL,
            password_hash VARCHAR(100) NOT NULL,
            PRIMARY KEY (user_id),
            UNIQUE (username)
        );
    `;

    const createRoomSQL = `
        CREATE TABLE IF NOT EXISTS room (
            room_id INT NOT NULL AUTO_INCREMENT,
            name VARCHAR(200) NOT NULL,
            start_datetime DATETIME,
            PRIMARY KEY (room_id)
        );
    `;

    const createRoomUserSQL = `
        CREATE TABLE IF NOT EXISTS room_user (
            room_user_id INT NOT NULL AUTO_INCREMENT,
            user_id INT NOT NULL,
            room_id INT NOT NULL,
            last_read_message_id INT,
            PRIMARY KEY (room_user_id),
            UNIQUE (user_id, room_id),
            CONSTRAINT fk_ru_user
                FOREIGN KEY (user_id) REFERENCES user(user_id)
                ON DELETE CASCADE,
            CONSTRAINT fk_ru_room
                FOREIGN KEY (room_id) REFERENCES room(room_id)
                ON DELETE CASCADE
        );
    `;

    const createMessageSQL = `
        CREATE TABLE IF NOT EXISTS message (
            message_id INT NOT NULL AUTO_INCREMENT,
            room_user_id INT NOT NULL,
            sent_datetime DATETIME NOT NULL,
            text TEXT,
            PRIMARY KEY (message_id),
            CONSTRAINT fk_message_room_user
                FOREIGN KEY (room_user_id) REFERENCES room_user(room_user_id)
                ON DELETE CASCADE
        );
    `;

    const createEmojiSQL = `
        CREATE TABLE IF NOT EXISTS emoji (
            emoji_id INT NOT NULL AUTO_INCREMENT,
            name VARCHAR(45) NOT NULL,
            image VARCHAR(100) NOT NULL,
            PRIMARY KEY (emoji_id),
            UNIQUE (name)
        );
    `;

    const createReactionSQL = `
        CREATE TABLE IF NOT EXISTS reaction (
            reaction_id INT NOT NULL AUTO_INCREMENT,
            message_id INT NOT NULL,
            emoji_id INT NOT NULL,
            user_id INT NOT NULL,
            PRIMARY KEY (reaction_id),
            UNIQUE (message_id, emoji_id, user_id),
            CONSTRAINT fk_reaction_message
                FOREIGN KEY (message_id) REFERENCES message(message_id)
                ON DELETE CASCADE,
            CONSTRAINT fk_reaction_emoji
                FOREIGN KEY (emoji_id) REFERENCES emoji(emoji_id)
                ON DELETE CASCADE,
            CONSTRAINT fk_reaction_user
                FOREIGN KEY (user_id) REFERENCES user(user_id)
                ON DELETE CASCADE
        );
    `;

    // content_id is the short code itself (e.g. /aB3xY9). ascii_bin makes it case-sensitive.
    // data holds the destination URL for links (and later the text / image URL).
    const createContentSQL = `
        CREATE TABLE IF NOT EXISTS content (
            content_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            user_id INT NOT NULL,
            content_type ENUM('link', 'text', 'image') NOT NULL,
            data TEXT NOT NULL,
            active TINYINT(1) NOT NULL DEFAULT 1,
            hits INT NOT NULL DEFAULT 0,
            created_datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_hit_datetime DATETIME,
            PRIMARY KEY (content_id),
            CONSTRAINT fk_content_user
                FOREIGN KEY (user_id) REFERENCES user(user_id)
                ON DELETE CASCADE
        );
    `;

    const insertEmojiDataSQL = `
        INSERT IGNORE INTO emoji (name, image)
        VALUES
            ('thumbsup', 'thumbsup.png'),
            ('laugh', 'laugh.png'),
            ('fire', 'fire.png'),
            ('heart', 'heart.png'),
            ('eyes', 'eyes.png'),
            ('pleading', 'pleading.png');
        `;

    try {
        await database.query(dropContentSQL);
        await database.query(dropReactionSQL);
        await database.query(dropMessageSQL);
        await database.query(dropRoomUserSQL);
        await database.query(dropRoomSQL);
        await database.query(dropEmojiSQL);
        await database.query(dropUserSQL);

        await database.query(createUserSQL);
        await database.query(createRoomSQL);
        await database.query(createRoomUserSQL);
        await database.query(createMessageSQL);
        await database.query(createEmojiSQL);
        await database.query(createReactionSQL);
        await database.query(createContentSQL);

        console.log("Successfully created tables");
    }
    catch (err) {
        console.log("Error Creating tables");
        console.log(err);
        return false;
    }

    try {
        await database.query(insertEmojiDataSQL);
        console.log("Successfully inserted data");

    }
    catch (err) {
        console.log("Error inserting data");
        console.log(err);
        return false;
    }

    return true;

}


module.exports = { createTables };
