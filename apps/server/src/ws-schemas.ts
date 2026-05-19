import { z } from 'zod';

/**
 * Inbound frames the workspace WebSocket accepts. Anything that fails this
 * schema is logged and dropped — the server never disconnects the client for
 * bad frames (friendly to future-proofing + noisy browser tabs).
 */
export const clientFrameSchema = z.discriminatedUnion('type', [
  z.object({
    v: z.literal(1),
    type: z.literal('hello'),
    projectId: z.string().nullable(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal('project'),
    projectId: z.string().nullable(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal('ping'),
  }),
]);

export type ClientFrame = z.infer<typeof clientFrameSchema>;
