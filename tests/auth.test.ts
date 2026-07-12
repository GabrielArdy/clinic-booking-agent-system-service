import { describe, expect, it } from "vitest";
import { testDb, testRepos } from "./helpers.js";
import { AuthService, GROUPS, GROUP_DEFAULT_ROLES, ROLES } from "../src/services/auth-service.js";
import { DomainError } from "../src/domain/types.js";

async function setup(ttlHours = 24, now?: () => Date) {
  const db = await testDb();
  const repos = testRepos(db);
  const auth = new AuthService(repos, ttlHours, now);
  return { db, repos, auth };
}

describe("seeded RBAC masters", () => {
  it("seeds groups, roles, positions, and demo users", async () => {
    const { repos } = await setup();
    const groups = (await repos.auth.listGroups()).map((g) => g.groupCode);
    expect(groups).toEqual([GROUPS.ADMIN, GROUPS.DOCTOR, GROUPS.STAFF]);

    const roles = (await repos.auth.listRoles()).map((r) => r.roleCode);
    expect(roles).toContain(ROLES.CMS_POSITION);
    expect(roles).toContain(ROLES.STF_DASHBOARD);
    expect(roles).toContain(ROLES.STF_CHAT);
    expect(roles).toHaveLength(13);

    const positions = (await repos.auth.listPositions()).map((p) => p.positionCode);
    expect(positions).toEqual(expect.arrayContaining(["A001", "D001", "D012", "N001", "P001", "DA01"]));

    const admin = await repos.auth.findUserByEmail("admin@clinic.test");
    expect(admin?.groupCode).toBe(GROUPS.ADMIN);
    const doctor = await repos.auth.findUserByEmail("doctor@clinic.test");
    expect(doctor?.doctorId).not.toBeNull();
    const staff = await repos.auth.findUserByEmail("staff@clinic.test");
    expect(staff?.staffId).not.toBeNull();
  });
});

describe("AuthService", () => {
  it("logs in with seeded credentials and returns the role bundle", async () => {
    const { auth } = await setup();
    const result = await auth.login("admin@clinic.test", "Admin123!");
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.user.roles).toEqual(
      expect.arrayContaining(GROUP_DEFAULT_ROLES[GROUPS.ADMIN] ?? []),
    );

    const me = await auth.authenticate(result.token);
    expect(me?.email).toBe("admin@clinic.test");
    expect(me?.positionCode).toBe("A001");
  });

  it("rejects a wrong password and unknown email with the same error", async () => {
    const { auth } = await setup();
    await expect(auth.login("admin@clinic.test", "nope-nope")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(auth.login("ghost@clinic.test", "Admin123!")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("revokes the session on logout", async () => {
    const { auth } = await setup();
    const { token } = await auth.login("doctor@clinic.test", "Doctor123!");
    expect(await auth.authenticate(token)).not.toBeNull();
    await auth.logout(token);
    expect(await auth.authenticate(token)).toBeNull();
  });

  it("expires tokens after the TTL", async () => {
    const { repos } = await setup();
    let t = Date.now();
    const auth = new AuthService(repos, 1, () => new Date(t)); // 1h TTL
    const { token } = await auth.login("staff@clinic.test", "Staff123!");
    expect(await auth.authenticate(token)).not.toBeNull();
    t += 61 * 60 * 1000; // 61 minutes later
    expect(await auth.authenticate(token)).toBeNull();
  });

  it("blocks inactive accounts from logging in and from using live tokens", async () => {
    const { auth, repos } = await setup();
    const { token, user } = await auth.login("staff@clinic.test", "Staff123!");
    await repos.auth.updateUser(user.id, { status: "INACTIVE" });
    expect(await auth.authenticate(token)).toBeNull();
    await expect(auth.login("staff@clinic.test", "Staff123!")).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("creates a user with the position group's default roles", async () => {
    const { auth } = await setup();
    const user = await auth.createUser({
      email: "new.doctor@clinic.test",
      password: "Doctor456!",
      fullName: "Dr. New Doctor",
      positionCode: "D012",
      doctorId: 2,
    });
    expect(user.groupCode).toBe(GROUPS.DOCTOR);
    expect([...user.roles].sort()).toEqual([...(GROUP_DEFAULT_ROLES[GROUPS.DOCTOR] ?? [])].sort());
    const login = await auth.login("new.doctor@clinic.test", "Doctor456!");
    expect(login.user.doctorId).toBe(2);
  });

  it("rejects duplicate emails and unknown positions", async () => {
    const { auth } = await setup();
    await expect(
      auth.createUser({
        email: "admin@clinic.test",
        password: "Whatever1!",
        fullName: "Dup",
        positionCode: "A001",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      auth.createUser({
        email: "x@clinic.test",
        password: "Whatever1!",
        fullName: "X",
        positionCode: "Z999",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("replaces roles via updateUser", async () => {
    const { auth } = await setup();
    const created = await auth.createUser({
      email: "limited@clinic.test",
      password: "Limited1!",
      fullName: "Limited Admin",
      positionCode: "A001",
      roles: [ROLES.AUDIT_LOG],
    });
    expect(created.roles).toEqual([ROLES.AUDIT_LOG]);
    const updated = await auth.updateUser(created.id, {
      roles: [ROLES.CMS_CLINIC, ROLES.CMS_THEME],
    });
    expect(updated.roles.sort()).toEqual([ROLES.CMS_CLINIC, ROLES.CMS_THEME].sort());
  });
});

describe("position CMS + audit log repos", () => {
  it("creates, updates, and soft-deletes a position", async () => {
    const { repos } = await setup();
    const created = await repos.auth.createPosition({
      positionCode: "DA02",
      positionName: "Senior Dental Assistant",
      groupCode: GROUPS.STAFF,
    });
    expect(created.positionName).toBe("Senior Dental Assistant");
    const updated = await repos.auth.updatePosition("DA02", { positionName: "Lead DA" });
    expect(updated?.positionName).toBe("Lead DA");
    expect(await repos.auth.deletePosition("DA02")).toBe(true);
    expect(await repos.auth.findPositionByCode("DA02")).toBeNull();
  });

  it("lists audit events newest first with type filter", async () => {
    const { auth, repos } = await setup();
    await auth.login("admin@clinic.test", "Admin123!");
    await repos.audit.record("test_event", { a: 1 });
    const all = await repos.audit.list({ limit: 10, offset: 0 });
    expect(all[0]?.eventType).toBe("test_event");
    const logins = await repos.audit.list({ limit: 10, offset: 0, eventType: "auth_login" });
    expect(logins.every((e) => e.eventType === "auth_login")).toBe(true);
    expect(logins.length).toBeGreaterThan(0);
  });
});

describe("DomainError auth codes", () => {
  it("exposes UNAUTHORIZED and FORBIDDEN", () => {
    expect(new DomainError("UNAUTHORIZED", "x").code).toBe("UNAUTHORIZED");
    expect(new DomainError("FORBIDDEN", "x").code).toBe("FORBIDDEN");
  });
});
