import type { RequestHandler } from "express";
/** Bounded process-local management limiter. No PIN login is enabled by this guard. */
export function createPinRateLimiter(
  now = () => Date.now(),
  limit = 10,
  windowMs = 15 * 60 * 1000,
): RequestHandler {
  const buckets = new Map<string, { count: number; until: number }>();
  return (req, res, next) => {
    const time = now();
    const key = String(req.authUser?.id ?? "anonymous");
    if (buckets.size >= 10000)
      for (const [k, b] of buckets) if (b.until <= time) buckets.delete(k);
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= time) {
      if (buckets.size >= 10000 && !bucket) {
        res
          .status(429)
          .json({
            error: {
              code: "PIN_RATE_LIMIT",
              message: "請稍後再試。",
              requestId: req.id,
            },
          });
        return;
      }
      bucket = { count: 0, until: time + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((bucket.until - time) / 1000)),
      );
      res
        .status(429)
        .json({
          error: {
            code: "PIN_RATE_LIMIT",
            message: "PIN 管理操作過於頻繁，請稍後再試。",
            requestId: req.id,
          },
        });
      return;
    }
    bucket.count++;
    next();
  };
}
