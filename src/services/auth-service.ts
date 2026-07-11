import { randomBytes } from "node:crypto";
import { DomainError, type AuthUser } from "../domain/types.js";
import type { AuthUserRecord, Repositories } from "../repositories/ports.js";
import { hashPassword, verifyPassword } from "./password.js";

/** Group codes (master_groups.group_code). */
export const GROUPS = {
  ADMIN: "AD100",
  DOCTOR: "DOC100",
  STAFF: "STF100",
} as const;

/**
 * App-level role catalog (master_roles.role_code). Every protected endpoint
 * group is guarded by one of these codes; a user gets access when any of its
 * assigned roles matches.
 */
export const ROLES = {
  // Admin group
  ADM_DASHBOARD: "ADM_DASHBOARD", // admin dashboard + operational admin endpoints
  CMS_CLINIC: "CMS_CLINIC",
  CMS_STAFF_DOCTOR: "CMS_STAFF_DOCTOR", // staff & doctor CMS (incl. specialties)
  CMS_THEME: "CMS_THEME",
  AUDIT_LOG: "AUDIT_LOG",
  CMS_SLOT: "CMS_SLOT",
  CMS_ROSTER: "CMS_ROSTER", // shifts + shift assignments
  CMS_POSITION: "CMS_POSITION", // positions, groups, roles, user accounts
  // Doctor group
  DOC_DASHBOARD: "DOC_DASHBOARD", // schedule page + today's shift
  DOC_EXCEPTION: "DOC_EXCEPTION", // own blocking time
  DOC_APPOINTMENT: "DOC_APPOINTMENT", // own appointment list + detail
  // Staff group
  STF_DASHBOARD: "STF_DASHBOARD", // today's shift info
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

/** Default role bundle granted when creating a user of a group. */
export const GROUP_DEFAULT_ROLES: Record<string, RoleCode[]> = {
  [GROUPS.ADMIN]: [
    ROLES.ADM_DASHBOARD,
    ROLES.CMS_CLINIC,
    ROLES.CMS_STAFF_DOCTOR,
    ROLES.CMS_THEME,
    ROLES.AUDIT_LOG,
    ROLES.CMS_SLOT,
    ROLES.CMS_ROSTER,
    ROLES.CMS_POSITION,
  ],
  [GROUPS.DOCTOR]: [ROLES.DOC_DASHBOARD, ROLES.DOC_EXCEPTION, ROLES.DOC_APPOINTMENT],
  [GROUPS.STAFF]: [ROLES.STF_DASHBOARD],
};

export interface LoginResult {
  token: string;
  expiresAt: string; // ISO datetime
  user: AuthUser;
}

export class AuthService {
  constructor(
    private readonly repos: Repositories,
    private readonly tokenTtlHours: number = 24,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Public profile: record + roles, password hash stripped. */
  private async profile(record: AuthUserRecord): Promise<AuthUser> {
    const roles = await this.repos.auth.rolesForUser(record.id);
    return {
      id: record.id,
      email: record.email,
      fullName: record.fullName,
      positionCode: record.positionCode,
      positionName: record.positionName,
      groupCode: record.groupCode,
      doctorId: record.doctorId,
      staffId: record.staffId,
      status: record.status,
      roles,
    };
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const record = await this.repos.auth.findUserByEmail(email);
    // Same error for unknown email and wrong password (no user enumeration).
    if (!record || !verifyPassword(password, record.passwordHash)) {
      throw new DomainError("UNAUTHORIZED", "Invalid email or password");
    }
    if (record.status !== "ACTIVE") {
      throw new DomainError("UNAUTHORIZED", "Account is inactive");
    }
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(
      this.now().getTime() + this.tokenTtlHours * 60 * 60 * 1000,
    ).toISOString();
    await this.repos.auth.createSession(record.id, token, expiresAt);
    await this.repos.audit.record("auth_login", { userId: record.id, email: record.email });
    return { token, expiresAt, user: await this.profile(record) };
  }

  /** Resolves a bearer token to its user, or null when invalid/expired. */
  async authenticate(token: string): Promise<AuthUser | null> {
    if (!token) return null;
    const session = await this.repos.auth.findSession(token);
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() <= this.now().getTime()) return null;
    const record = await this.repos.auth.findUserById(session.userId);
    if (!record || record.status !== "ACTIVE") return null;
    return this.profile(record);
  }

  async logout(token: string): Promise<void> {
    await this.repos.auth.revokeSession(token);
  }

  /**
   * Creates a login account (admin console). Roles default to the position's
   * group bundle when not given explicitly.
   */
  async createUser(input: {
    email: string;
    password: string;
    fullName: string;
    positionCode: string;
    doctorId?: number | null;
    staffId?: number | null;
    roles?: string[];
  }): Promise<AuthUser> {
    const position = await this.repos.auth.findPositionByCode(input.positionCode);
    if (!position) throw new DomainError("NOT_FOUND", "Position not found");
    if (input.password.length < 8) {
      throw new DomainError("INVALID_INPUT", "Password must be at least 8 characters");
    }
    if (await this.repos.auth.findUserByEmail(input.email)) {
      throw new DomainError("INVALID_INPUT", "Email already registered");
    }
    const record = await this.repos.auth.createUser({
      email: input.email,
      passwordHash: hashPassword(input.password),
      fullName: input.fullName,
      positionCode: input.positionCode,
      doctorId: input.doctorId ?? null,
      staffId: input.staffId ?? null,
    });
    const roles = input.roles ?? GROUP_DEFAULT_ROLES[position.groupCode] ?? [];
    await this.repos.auth.setUserRoles(record.id, roles);
    await this.repos.audit.record("auth_user_created", {
      userId: record.id,
      email: record.email,
      positionCode: record.positionCode,
      roles,
    });
    return this.profile(record);
  }

  async updateUser(
    id: number,
    patch: {
      fullName?: string;
      password?: string;
      positionCode?: string;
      doctorId?: number | null;
      staffId?: number | null;
      status?: "ACTIVE" | "INACTIVE";
      roles?: string[];
    },
  ): Promise<AuthUser> {
    if (patch.positionCode !== undefined) {
      const position = await this.repos.auth.findPositionByCode(patch.positionCode);
      if (!position) throw new DomainError("NOT_FOUND", "Position not found");
    }
    if (patch.password !== undefined && patch.password.length < 8) {
      throw new DomainError("INVALID_INPUT", "Password must be at least 8 characters");
    }
    const record = await this.repos.auth.updateUser(id, {
      fullName: patch.fullName,
      passwordHash: patch.password !== undefined ? hashPassword(patch.password) : undefined,
      positionCode: patch.positionCode,
      doctorId: patch.doctorId,
      staffId: patch.staffId,
      status: patch.status,
    });
    if (!record) throw new DomainError("NOT_FOUND", "User not found");
    if (patch.roles !== undefined) await this.repos.auth.setUserRoles(id, patch.roles);
    await this.repos.audit.record("auth_user_updated", { userId: id });
    return this.profile(record);
  }

  async listUsers(): Promise<AuthUser[]> {
    const records = await this.repos.auth.listUsers();
    return Promise.all(records.map((r) => this.profile(r)));
  }
}
