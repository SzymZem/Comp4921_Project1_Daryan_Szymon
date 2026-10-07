const crypto = require('crypto');
const database = require('../databaseConnection');

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const CODE_LENGTH = 6;
const MAX_GENERATE_ATTEMPTS = 5;
const CUSTOM_CODE_REGEX = /^[A-Za-z0-9_-]{3,32}$/;
const MAX_TEXT_LENGTH = 10000;
const CONTENT_TYPES = ['link', 'text', 'image'];

// Each content type has its own table. Queries alias the columns back to
// content_id / data so callers and views don't care which table a row came from.
// These names come from this fixed map only, never from user input.
const CONTENT_TABLES = {
	link: { table: 'link', id: 'link_id', value: 'link_to' },
	text: { table: 'text', id: 'text_id', value: 'text_value' },
	image: { table: 'image', id: 'image_id', value: 'image_public_id' }
};

// Short codes live at the site root (e.g. /abc123), so they can't collide with
// our own single-segment routes. Express routing is case-insensitive, so compare lowercase.
const RESERVED_CODES = new Set([
	'about', 'contact', 'submitemail', 'createtables', 'signup', 'members', 'login',
	'submituser', 'loggingin', 'logout', 'loggedin', 'api', 'creategroup', 'group',
	'message', 'links', 'content', 'emojis', 'leaderboard'
]);

// --- Leaderboard scoring ---
// A link's score is how many characters the short URL saved. To stop people gaming it,
// padding is stripped before measuring and known "make my URL huge" sites score 0.
const MAX_SCORED_URL_LENGTH = 2048;
const TRACKING_PARAM_REGEX = /^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|yclid|_ga|_gl|ref|ref_src)$/i;
const BLOCKED_HOSTS = [
	// long-URL generators
	'longurlmaker.com', 'hugeurl.com', 'shadyurl.com', 'loooooooooooooooooooooooooooooooooooooooooooooooooooooooooooong.com',
	'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.com', 'thelongesturl.com', 'hugelink.com',
	'longurl.org', 'urlextender.com', 'makeitlong.com', 'lengthenurl.com', 'longify.com',
	// other shorteners (shortening a short link isn't a real shortening)
	'bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'tiny.cc'
];

function isBlockedHost(hostname, ownHost) {
	const host = hostname.toLowerCase();
	if (ownHost && host === ownHost.toLowerCase()) {
		return true;
	}
	return BLOCKED_HOSTS.some(blocked => host === blocked || host.endsWith('.' + blocked));
}

// Catches generated gibberish the blocklist doesn't know about.
function looksPadded(parsed) {
	const labels = parsed.hostname.split('.');
	if (labels.some(label => label.length > 40) || /(.)\1{7,}/.test(parsed.hostname)) {
		return true;
	}
	const rest = decodeURIComponentSafe(parsed.pathname + parsed.search);
	if (/(.)\1{14,}/.test(rest)) {
		return true;
	}
	return rest.split(/[\/?&=]/).some(segment => segment.length > 200);
}

function decodeURIComponentSafe(s) {
	try {
		return decodeURIComponent(s);
	}
	catch (err) {
		return s;
	}
}

// Removes the parts of a URL that don't change where it goes: #fragment, tracking
// params, empty params and trailing slashes.
function stripPadding(url) {
	const parsed = new URL(url);
	parsed.hash = '';
	for (const key of [...parsed.searchParams.keys()]) {
		if (TRACKING_PARAM_REGEX.test(key) || parsed.searchParams.get(key) === '') {
			parsed.searchParams.delete(key);
		}
	}
	parsed.pathname = parsed.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
	return parsed;
}

// Returns { scoredUrl, charsSaved }. charsSaved is 0 when the link isn't eligible.
function scoreLink(url, code, baseUrl) {
	try {
		const parsed = stripPadding(url);
		const scoredUrl = parsed.href;
		const ownHost = baseUrl ? new URL(baseUrl).hostname : null;
		if (scoredUrl.length > MAX_SCORED_URL_LENGTH || isBlockedHost(parsed.hostname, ownHost) || looksPadded(parsed)) {
			return { scoredUrl, charsSaved: 0 };
		}
		const shortLength = (baseUrl + '/' + code).length;
		return { scoredUrl, charsSaved: Math.max(0, scoredUrl.length - shortLength) };
	}
	catch (err) {
		return { scoredUrl: null, charsSaved: 0 };
	}
}

function isReservedCode(code) {
	return RESERVED_CODES.has(code.toLowerCase());
}

function isValidCustomCode(code) {
	return CUSTOM_CODE_REGEX.test(code) && !isReservedCode(code);
}

function isValidText(text) {
	return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_TEXT_LENGTH;
}

function generateCode() {
	let code;
	do {
		code = '';
		for (let i = 0; i < CODE_LENGTH; i++) {
			code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
		}
	} while (isReservedCode(code));
	return code;
}

// Returns a normalized http(s) URL, or null if the input isn't one.
// Rejects other schemes (javascript:, data:, etc.) so a short link can't be used for XSS.
function normalizeUrl(input) {
	let url = (input || '').trim();
	if (url.length === 0) {
		return null;
	}
	if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
		url = 'https://' + url;
	}

	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return null;
		}
		return parsed.href;
	}
	catch (err) {
		return null;
	}
}

// Duplicate codes within one table are rejected by its PRIMARY KEY, so two requests
// racing for the same code can't both succeed - the loser gets ER_DUP_ENTRY.
// Codes also have to be unique across all three tables, which no single key covers,
// so after inserting we check the other tables and back out if the code is there.
// If two inserts into different tables race, each sees the other and both back out,
// which is safe: neither code ends up shared.
async function insertContent(contentId, userId, contentType, data, options = {}) {
	const t = CONTENT_TABLES[contentType];
	if (contentType === 'link') {
		// custom codes never score, so there's no point measuring them
		const isCustom = options.isCustom ? 1 : 0;
		const { scoredUrl, charsSaved } = isCustom
			? { scoredUrl: null, charsSaved: 0 }
			: scoreLink(data, contentId, options.baseUrl);
		let insertLinkSQL = `
			INSERT INTO link
			(link_id, user_id, link_to, is_custom, scored_url, chars_saved)
			VALUES
			(?, ?, ?, ?, ?, ?);
		`;
		await database.query(insertLinkSQL, [contentId, userId, data, isCustom, scoredUrl, charsSaved]);
	}
	else {
		let insertSQL = `
			INSERT INTO \`${t.table}\`
			(${t.id}, user_id, ${t.value})
			VALUES
			(?, ?, ?);
		`;
		await database.query(insertSQL, [contentId, userId, data]);
	}

	const others = CONTENT_TYPES.filter(type => type !== contentType).map(type => CONTENT_TABLES[type]);
	let takenSQL = others
		.map(o => `SELECT 1 FROM \`${o.table}\` WHERE ${o.id} = ?`)
		.join(' UNION ALL ');

	const [rows] = await database.query(takenSQL, others.map(() => contentId));
	if (rows.length > 0) {
		await database.query(`DELETE FROM \`${t.table}\` WHERE ${t.id} = ?;`, [contentId]);
		const err = new Error("Short code already used by another content type");
		err.code = 'ER_DUP_ENTRY';
		throw err;
	}
}

async function createContent(userId, contentType, data, customCode, baseUrl) {
	if (customCode) {
		try {
			await insertContent(customCode, userId, contentType, data, { isCustom: true, baseUrl });
			return { success: true, contentId: customCode };
		}
		catch (err) {
			if (err.code === 'ER_DUP_ENTRY') {
				return { success: false, error: "That short URL is already taken." };
			}
			console.log("Error creating content");
			console.log(err);
			return { success: false, error: "Failed to create content." };
		}
	}

	for (let attempt = 0; attempt < MAX_GENERATE_ATTEMPTS; attempt++) {
		const code = generateCode();
		try {
			await insertContent(code, userId, contentType, data, { baseUrl });
			return { success: true, contentId: code };
		}
		catch (err) {
			if (err.code === 'ER_DUP_ENTRY') {
				continue;
			}
			console.log("Error creating content");
			console.log(err);
			return { success: false, error: "Failed to create content." };
		}
	}

	return { success: false, error: "Failed to generate a unique short URL. Please try again." };
}

async function getContent(contentId) {
	let getContentSQL = CONTENT_TYPES
		.map(type => {
			const t = CONTENT_TABLES[type];
			return `
				SELECT ${t.id} AS content_id, user_id, '${type}' AS content_type, ${t.value} AS data, active
				FROM \`${t.table}\`
				WHERE ${t.id} = ?`;
		})
		.join(' UNION ALL ') + ';';

	try {
		const [rows] = await database.query(getContentSQL, CONTENT_TYPES.map(() => contentId));
		return rows[0] || null;
	}
	catch (err) {
		console.log("Error getting content");
		console.log(err);
		return null;
	}
}

async function getUserContent(userId, contentType) {
	const t = CONTENT_TABLES[contentType];
	let getUserContentSQL = `
		SELECT ${t.id} AS content_id, '${contentType}' AS content_type, ${t.value} AS data,
			active, hits, created_datetime, last_hit_datetime
		FROM \`${t.table}\`
		WHERE user_id = ?
		ORDER BY created_datetime DESC;
	`;

	try {
		const [rows] = await database.query(getUserContentSQL, [userId]);
		return rows;
	}
	catch (err) {
		console.log("Error getting user content");
		console.log(err);
		return [];
	}
}

async function recordHit(contentType, contentId) {
	const t = CONTENT_TABLES[contentType];
	let recordHitSQL = `
		UPDATE \`${t.table}\`
		SET hits = hits + 1, last_hit_datetime = NOW()
		WHERE ${t.id} = ?;
	`;

	try {
		await database.query(recordHitSQL, [contentId]);
	}
	catch (err) {
		console.log("Error recording hit");
		console.log(err);
	}
}

// Only visits from someone other than the owner count toward the leaderboard.
async function recordExternalHit(linkId) {
	let recordExternalHitSQL = `
		UPDATE link
		SET external_hits = external_hits + 1
		WHERE link_id = ?;
	`;

	try {
		await database.query(recordExternalHitSQL, [linkId]);
	}
	catch (err) {
		console.log("Error recording external hit");
		console.log(err);
	}
}

// Each user's single best qualifying link. The inner ROW_NUMBER picks one link per
// user per destination (no duplicate URLs), the outer one picks the user's best.
async function getLeaderboard(limit = 25) {
	let getLeaderboardSQL = `
		SELECT u.username, best.link_id, best.link_to, best.chars_saved
		FROM (
			SELECT dedup.*,
				ROW_NUMBER() OVER (PARTITION BY dedup.user_id ORDER BY dedup.chars_saved DESC, dedup.created_datetime) AS user_rank
			FROM (
				SELECT link_id, user_id, link_to, chars_saved, created_datetime,
					ROW_NUMBER() OVER (PARTITION BY user_id, scored_url ORDER BY created_datetime) AS dup_rank
				FROM link
				WHERE is_custom = 0 AND active = 1 AND external_hits >= 1 AND chars_saved > 0
			) dedup
			WHERE dedup.dup_rank = 1
		) best
		JOIN user u ON u.user_id = best.user_id
		WHERE best.user_rank = 1
		ORDER BY best.chars_saved DESC, best.created_datetime
		LIMIT ?;
	`;

	try {
		const [rows] = await database.query(getLeaderboardSQL, [limit]);
		return rows;
	}
	catch (err) {
		console.log("Error getting leaderboard");
		console.log(err);
		return [];
	}
}

// The user_id check makes these no-ops on content the user doesn't own.
// Returns true only if a row owned by the user was changed.
async function toggleActive(contentType, contentId, userId) {
	const t = CONTENT_TABLES[contentType];
	let toggleSQL = `
		UPDATE \`${t.table}\`
		SET active = NOT active
		WHERE ${t.id} = ? AND user_id = ?;
	`;

	try {
		const [result] = await database.query(toggleSQL, [contentId, userId]);
		return result.affectedRows > 0;
	}
	catch (err) {
		console.log("Error toggling content");
		console.log(err);
		return false;
	}
}

async function deleteContent(contentType, contentId, userId) {
	const t = CONTENT_TABLES[contentType];
	let deleteSQL = `
		DELETE FROM \`${t.table}\`
		WHERE ${t.id} = ? AND user_id = ?;
	`;

	try {
		const [result] = await database.query(deleteSQL, [contentId, userId]);
		return result.affectedRows > 0;
	}
	catch (err) {
		console.log("Error deleting content");
		console.log(err);
		return false;
	}
}

module.exports = {
	CONTENT_TYPES,
	MAX_TEXT_LENGTH,
	isValidCustomCode,
	isValidText,
	normalizeUrl,
	createContent,
	getContent,
	getUserContent,
	recordHit,
	recordExternalHit,
	getLeaderboard,
	MAX_SCORED_URL_LENGTH,
	toggleActive,
	deleteContent
};
