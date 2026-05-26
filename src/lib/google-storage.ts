import { Storage } from "@google-cloud/storage";

let storage: Storage | null = null;

export function getStorage() {
  if (!storage) {
    storage = new Storage({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  }

  return storage;
}

export function getRouteOptimizationBucket() {
  const bucketName = process.env.GOOGLE_ROUTE_OPTIMIZATION_BUCKET;

  if (!bucketName) {
    throw new Error("Missing GOOGLE_ROUTE_OPTIMIZATION_BUCKET");
  }

  return getStorage().bucket(bucketName);
}
