import path from "node:path";

export const PASSWORD = "Grevya@123";

export const USERS = {
  priya: { email: "priya@grevya.com", name: "Priya Nair", first: "Priya" }, // employee, manager = kavin
  rahul: { email: "rahul@grevya.com", name: "Rahul Verma", first: "Rahul" }, // employee
  kavin: { email: "kavin@grevya.com", name: "Kavin N R", first: "Kavin" }, // manager / approver
  manoj: { email: "manoj@grevya.com", name: "Manoj Pillai", first: "Manoj" }, // IT agent
  lakshmi: { email: "lakshmi@grevya.com", name: "Lakshmi Prasad", first: "Lakshmi" }, // IT agent
  arvind: { email: "arvind@grevya.com", name: "Arvind Krishnan", first: "Arvind" }, // IT lead
  hr: { email: "hr@grevya.com", name: "Ananya Iyer", first: "Ananya" }, // HR lead
  divya: { email: "divya@grevya.com", name: "Divya Menon", first: "Divya" }, // HR agent
  admin: { email: "admin@grevya.com", name: "Grevya Admin", first: "Grevya" }, // desk admin
} as const;

export type Role = keyof typeof USERS;

export const ROLES = Object.keys(USERS) as Role[];

/** storageState file for a role (written by auth.setup.ts). */
export const stateFile = (role: Role) => path.resolve(__dirname, "../.auth", `${role}.json`);

export const TEAM = { it: "IT Support", hr: "HR" } as const;
