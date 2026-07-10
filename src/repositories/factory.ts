import type { Database } from "../db/executor.js";
import type { DbType } from "../db/executor.js";
import type { Repositories, RepositoryFactory } from "./ports.js";
import { makeSqliteRepos } from "./sqlite/repos.js";
import { makePgRepos } from "./postgres/repos.js";

/** Returns the dialect-specific repositories factory. */
export function repositoryFactory(type: DbType): RepositoryFactory {
  return type === "postgres" ? makePgRepos : makeSqliteRepos;
}

/** Base repositories bound to the connection, plus the factory for tx scoping. */
export function buildRepositories(db: Database): {
  repos: Repositories;
  makeRepos: RepositoryFactory;
} {
  const makeRepos = repositoryFactory(db.type);
  return { makeRepos, repos: makeRepos(db) };
}
