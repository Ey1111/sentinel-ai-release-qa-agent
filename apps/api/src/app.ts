import Fastify from "fastify";

type AppDependencies = { checkDatabase: () => Promise<boolean> };

export function buildApp(dependencies: AppDependencies) {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({ service: "sentinel-api", status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    const available = await dependencies.checkDatabase();
    if (!available) {
      return reply.code(503).send({ database: "unavailable", status: "not-ready" });
    }
    return { database: "available", status: "ready" };
  });
  return app;
}
