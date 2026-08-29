import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { createDeveloperApiKey, createPolicyForUser, getDeveloperApiUsageSummaryForUser, listCheckHistoryForUser, listDeveloperApiKeysForUser, listPoliciesForUser, recordCheckForUser, revokeDeveloperApiKey, updatePolicyForUser } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, paidProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { evaluateCheck, parsePreference } from "./firewall";
import { createExtensionAccessToken } from "./extensionSemanticApi";
import { getPolicyByIdForUser } from "./db";
import { getSubscriptionSummaryForUser } from "./subscriptionService";
import { createDeveloperApiSecret } from "./developerKeys";

const actionSchema = z.enum(["blur", "block", "warn"]);
const scopeSchema = z.object({ text: z.boolean(), images: z.boolean() });
const rulesSchema = z.array(z.object({ term: z.string().trim().min(2).max(120), action: actionSchema })).min(1).max(12);
const policyInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sourcePreference: z.string().trim().min(3).max(1000),
  language: z.enum(["ar", "en"]),
  action: actionSchema,
  scope: scopeSchema,
  rules: rulesSchema,
});

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  account: router({
    subscription: protectedProcedure.query(({ ctx }) => getSubscriptionSummaryForUser(ctx.user)),
    checkoutAvailability: protectedProcedure.query(() => ({ available: false, reason: "Stripe keys are required before checkout can be enabled." })),
  }),
  developer: router({
    keys: adminProcedure.query(({ ctx }) => listDeveloperApiKeysForUser(ctx.user.id)),
    usage: adminProcedure.query(({ ctx }) => getDeveloperApiUsageSummaryForUser(ctx.user.id)),
    createKey: adminProcedure.input(z.object({ label: z.string().trim().min(2).max(80) })).mutation(async ({ ctx, input }) => {
      const key = createDeveloperApiSecret();
      const id = await createDeveloperApiKey({ userId: ctx.user.id, label: input.label, ...key, rateLimitPerMinute: 5 });
      return { id, label: input.label, key: key.secret, keyPrefix: key.keyPrefix, rateLimitPerMinute: 5 };
    }),
    revokeKey: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ ctx, input }) => revokeDeveloperApiKey({ id: input.id, userId: ctx.user.id })),
  }),
  firewall: router({
    parsePreference: publicProcedure.input(z.object({
      preference: z.string().trim().min(3).max(1000),
      requestedAction: actionSchema.optional(),
    })).mutation(({ input }) => parsePreference(input.preference, input.requestedAction)),
    evaluate: paidProcedure.input(z.object({
      policyId: z.number().int().positive().optional(),
      rules: rulesSchema,
      scope: scopeSchema,
      inputType: z.enum(["text", "image"]),
      value: z.string().trim().min(3).max(4000),
    })).mutation(async ({ ctx, input }) => {
      const result = evaluateCheck(input);
      if (ctx.user) {
        await recordCheckForUser({
          userId: ctx.user.id,
          policyId: input.policyId,
          inputType: input.inputType,
          inputValue: input.value,
          result,
        });
      }
      return result;
    }),
    policies: router({
      list: paidProcedure.query(({ ctx }) => listPoliciesForUser(ctx.user.id)),
      create: paidProcedure.input(policyInputSchema).mutation(async ({ ctx, input }) => {
        const id = await createPolicyForUser({
          userId: ctx.user.id,
          name: input.name,
          sourcePreference: input.sourcePreference,
          language: input.language,
          action: input.action,
          scopeText: input.scope.text,
          scopeImages: input.scope.images,
          rules: input.rules,
        });
        return { id };
      }),
      update: paidProcedure.input(policyInputSchema.extend({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        const policy = await updatePolicyForUser({
          id: input.id,
          userId: ctx.user.id,
          name: input.name,
          sourcePreference: input.sourcePreference,
          language: input.language,
          action: input.action,
          scopeText: input.scope.text,
          scopeImages: input.scope.images,
          rules: input.rules,
        });
        if (!policy || policy.userId !== ctx.user.id) throw new Error("Policy not found.");
        return policy;
      }),
      extensionAccess: paidProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
        const policy = await getPolicyByIdForUser(input.id, ctx.user.id);
        if (!policy) throw new Error("Policy not found.");
        const access = createExtensionAccessToken(policy.id, ctx.user.id);
        const host = ctx.req.header("x-forwarded-host") || ctx.req.header("host");
        const proto = ctx.req.header("x-forwarded-proto")?.split(",")[0] || ctx.req.protocol || "https";
        if (!host) throw new Error("Unable to determine semantic endpoint.");
        const base = `${proto}://${host}/api/extension`;
        return { endpoint: `${base}/semantic-evaluate`, visualEndpoint: `${base}/visual-localize`, ...access };
      }),
    }),
    history: paidProcedure.input(z.object({ limit: z.number().int().min(1).max(20).default(8) }).optional()).query(({ ctx, input }) => listCheckHistoryForUser(ctx.user.id, input?.limit ?? 8)),
  }),
});

export type AppRouter = typeof appRouter;
