import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Command
} from '@aws-sdk/client-s3';

export function createR2Storage(env) {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('R2_NOT_CONFIGURED');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey }
  });
  return {
    async put(key, body, options = {}) {
      await client.send(new PutObjectCommand({
        Bucket: bucket, Key: key, Body: body,
        ContentType: options.httpMetadata?.contentType || 'application/octet-stream'
      }));
    },
    async get(key) {
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return {
          body: result.Body,
          httpMetadata: { contentType: result.ContentType || 'application/octet-stream' }
        };
      } catch (error) {
        if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async delete(keys) {
      if (!keys?.length) return;
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true }
      }));
    },
    async list({ prefix = '', cursor } = {}) {
      const result = await client.send(new ListObjectsV2Command({
        Bucket: bucket, Prefix: prefix, ContinuationToken: cursor
      }));
      return {
        objects: (result.Contents || []).map((item) => ({ key: item.Key })),
        truncated: !!result.IsTruncated,
        cursor: result.NextContinuationToken
      };
    }
  };
}
