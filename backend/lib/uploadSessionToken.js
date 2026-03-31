import crypto from 'crypto';

const getUploadTokenSecret = () => process.env.UPLOAD_TOKEN_SECRET || process.env.SESSION_SECRET || 'dev-secret';

const buildOwnerKey = ({ userId, ipFingerprint }) => {
    if (userId) return `user:${userId}`;
    if (ipFingerprint) return `guest:${ipFingerprint}`;
    return null;
};

const signUploadSession = (uploadId, ownerKey) => crypto
    .createHmac('sha256', getUploadTokenSecret())
    .update(`${uploadId}:${ownerKey}`)
    .digest('hex');

export const createUploadSessionToken = ({ uploadId, userId = null, ipFingerprint = null }) => {
    const ownerKey = buildOwnerKey({ userId, ipFingerprint });
    if (!uploadId || !ownerKey) return null;
    return signUploadSession(uploadId, ownerKey);
};

export const validateUploadSessionToken = ({ uploadId, token, userId = null, ipFingerprint = null }) => {
    const ownerKey = buildOwnerKey({ userId, ipFingerprint });
    if (!uploadId || !token || !ownerKey) return false;

    const expectedToken = signUploadSession(uploadId, ownerKey);
    const provided = Buffer.from(String(token));
    const expected = Buffer.from(expectedToken);

    if (provided.length !== expected.length) {
        return false;
    }

    return crypto.timingSafeEqual(provided, expected);
};

export default {
    createUploadSessionToken,
    validateUploadSessionToken,
};
