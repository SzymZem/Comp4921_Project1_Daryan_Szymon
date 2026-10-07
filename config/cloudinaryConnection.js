const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

const UPLOAD_FOLDER = 'comp4921';

// Uploads an in-memory image (from multer) and resolves to its public_id.
function uploadImage(buffer) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { folder: UPLOAD_FOLDER, resource_type: 'image' },
            (err, result) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(result.public_id);
            }
        );
        stream.end(buffer);
    });
}

async function deleteImage(publicId) {
    try {
        await cloudinary.uploader.destroy(publicId);
    }
    catch (err) {
        console.log("Error deleting image from Cloudinary");
        console.log(err);
    }
}

function imageUrl(publicId, options) {
    return cloudinary.url(publicId, { secure: true, ...options });
}

module.exports = { uploadImage, deleteImage, imageUrl };
