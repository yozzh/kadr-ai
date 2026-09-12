/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as brief from "../brief.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as jobs from "../jobs.js";
import type * as messageLimits from "../messageLimits.js";
import type * as messages from "../messages.js";
import type * as plan from "../plan.js";
import type * as planAction from "../planAction.js";
import type * as projects from "../projects.js";
import type * as questions from "../questions.js";
import type * as skills from "../skills.js";
import type * as slides from "../slides.js";
import type * as slidesAction from "../slidesAction.js";
import type * as supervisor from "../supervisor.js";
import type * as supervisorPrompt from "../supervisorPrompt.js";
import type * as supervisorState from "../supervisorState.js";
import type * as styles from "../styles.js";
import type * as toolContracts from "../toolContracts.js";
import type * as toolIds from "../toolIds.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  authz: typeof authz;
  brief: typeof brief;
  health: typeof health;
  http: typeof http;
  jobs: typeof jobs;
  messageLimits: typeof messageLimits;
  messages: typeof messages;
  plan: typeof plan;
  planAction: typeof planAction;
  projects: typeof projects;
  questions: typeof questions;
  skills: typeof skills;
  slides: typeof slides;
  slidesAction: typeof slidesAction;
  supervisor: typeof supervisor;
  supervisorPrompt: typeof supervisorPrompt;
  supervisorState: typeof supervisorState;
  styles: typeof styles;
  toolContracts: typeof toolContracts;
  toolIds: typeof toolIds;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
