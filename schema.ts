import { boolean, decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),
  guestToken: varchar("guestToken", { length: 64 }).unique(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed"]).default("pending").notNull(),
  paymentStatus: mysqlEnum("paymentStatus", ["unpaid", "paid", "refunded"]).default("unpaid").notNull(),
  originalImageKey: varchar("originalImageKey", { length: 512 }).notNull(),
  originalImageUrl: text("originalImageUrl").notNull(),
  generatedImageKey: varchar("generatedImageKey", { length: 512 }),
  generatedImageUrl: text("generatedImageUrl"),
  previewImageKey: varchar("previewImageKey", { length: 512 }),
  previewImageUrl: text("previewImageUrl"),
  previewGeneratedAt: timestamp("previewGeneratedAt"),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("usd").notNull(),
  childName: varchar("childName", { length: 255 }),
  childDescription: text("childDescription"),
  voiceSampleKey: varchar("voiceSampleKey", { length: 512 }),
  voiceSampleUrl: text("voiceSampleUrl"),
  elevenlabsVoiceId: varchar("elevenlabsVoiceId", { length: 255 }),
  shareToken: varchar("shareToken", { length: 64 }).unique(),
  storyTheme: varchar("storyTheme", { length: 100 }).default("adventure").notNull(),
  story: text("story"),
  storyApproved: boolean("storyApproved").default(false).notNull(),
  videoKey: varchar("videoKey", { length: 512 }),
  videoUrl: text("videoUrl"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  paidAt: timestamp("paidAt"),
  completedAt: timestamp("completedAt"),
});
export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

export const previewImages = mysqlTable("previewImages", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  imageKey: varchar("imageKey", { length: 512 }).notNull(),
  imageUrl: text("imageUrl").notNull(),
  mimeType: varchar("mimeType", { length: 50 }).default("image/png").notNull(),
  resolution: varchar("resolution", { length: 20 }).default("512x512").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PreviewImage = typeof previewImages.$inferSelect;
export type InsertPreviewImage = typeof previewImages.$inferInsert;

export const images = mysqlTable("images", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  imageKey: varchar("imageKey", { length: 512 }).notNull(),
  imageUrl: text("imageUrl").notNull(),
  mimeType: varchar("mimeType", { length: 50 }).default("image/png").notNull(),
  fileSize: int("fileSize"),
  generationModel: varchar("generationModel", { length: 100 }).default("pixar-3d").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Image = typeof images.$inferSelect;
export type InsertImage = typeof images.$inferInsert;

export const storyScenes = mysqlTable("storyScenes", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  sceneIndex: int("sceneIndex").notNull(),
  sceneText: text("sceneText").notNull(),
  illustrationPrompt: text("illustrationPrompt"),
  illustrationUrl: text("illustrationUrl"),
  illustrationKey: varchar("illustrationKey", { length: 512 }),
  narrationUrl: text("narrationUrl"),
  narrationKey: varchar("narrationKey", { length: 512 }),
  status: mysqlEnum("status", ["pending", "generating_image", "generating_audio", "completed", "failed"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type StoryScene = typeof storyScenes.$inferSelect;
export type InsertStoryScene = typeof storyScenes.$inferInsert;
