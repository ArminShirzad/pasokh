import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type { Locale } from "@/lib/i18n";

/**
 * Ready-made setups. Each creates ordinary objects (smart replies, a form, a
 * showcase, a sequence, a campaign) the owner then edits. Everything is
 * created PAUSED: a template must never start answering real followers on a
 * connected account before someone has read and switched it on.
 */
export const TEMPLATE_KEYS = ["city-menu", "price-showcase", "signup-form", "follow-up", "comment-giveaway"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

type Ctx = { tx: Prisma.TransactionClient; workspaceId: string; instagramAccountId: string; fa: boolean };
export type Created = { kind: "command" | "showcase" | "form" | "sequence" | "campaign"; id: string; name: string };

const text = (t: string) => ({ type: "text", text: t });

async function command(ctx: Ctx, data: { name: string; keywords: string[]; responses: unknown[]; formId?: string; sequenceId?: string }): Promise<Created> {
  const c = await ctx.tx.command.create({
    data: {
      workspaceId: ctx.workspaceId,
      instagramAccountId: ctx.instagramAccountId,
      isActive: false,
      name: data.name,
      keywords: data.keywords,
      responses: data.responses as Prisma.InputJsonValue,
      formId: data.formId,
      sequenceId: data.sequenceId,
    },
  });
  return { kind: "command", id: c.id, name: c.name };
}

const BUILDERS: Record<TemplateKey, (ctx: Ctx) => Promise<Created[]>> = {
  "city-menu": async (ctx) => {
    const { fa } = ctx;
    const tehran = await command(ctx, { name: fa ? "منو: تهران" : "Menu: Tehran", keywords: [], responses: [text(fa ? "شعبهٔ تهران: خیابان ولیعصر، ساعت ۱۰ تا ۲۲." : "Tehran branch: Valiasr St., 10:00–22:00.")] });
    const karaj = await command(ctx, { name: fa ? "منو: کرج" : "Menu: Karaj", keywords: [], responses: [text(fa ? "شعبهٔ کرج: گوهردشت، ساعت ۱۰ تا ۲۱." : "Karaj branch: Gohardasht, 10:00–21:00.")] });
    const menu = await command(ctx, {
      name: fa ? "منوی شعبه‌ها" : "Branches menu",
      keywords: fa ? ["شعبه", "آدرس"] : ["branch", "address"],
      responses: [{ ...text(fa ? "سلام {username} 👋 کدام شهر؟" : "Hi {username} 👋 Which city?"), quickReplies: [
        { title: fa ? "تهران" : "Tehran", payload: `cmd:${tehran.id}` },
        { title: fa ? "کرج" : "Karaj", payload: `cmd:${karaj.id}` },
      ] }],
    });
    return [menu, tehran, karaj];
  },

  "price-showcase": async (ctx) => {
    const { fa } = ctx;
    const products = fa
      ? [["کیف چرمی", "۱٬۲۰۰٬۰۰۰ تومان"], ["کیف پول", "۴۵۰٬۰۰۰ تومان"], ["کمربند", "۳۸۰٬۰۰۰ تومان"]]
      : [["Leather bag", "$49"], ["Wallet", "$19"], ["Belt", "$15"]];
    const shelf = await ctx.tx.showcase.create({
      data: {
        workspaceId: ctx.workspaceId,
        instagramAccountId: ctx.instagramAccountId,
        name: fa ? "محصولات (نمونه)" : "Products (sample)",
        cards: products.map(([title, subtitle]) => ({ title, subtitle, buttons: [{ type: "url", title: fa ? "خرید" : "Buy", url: "https://example.com" }] })),
      },
    });
    const reply = await command(ctx, {
      name: fa ? "قیمت‌ها" : "Prices",
      keywords: fa ? ["قیمت", "لیست قیمت"] : ["price", "prices"],
      responses: [text(fa ? "این‌ها محصولات ما هستند 👇" : "Here are our products 👇"), { type: "showcase", showcaseId: shelf.id }],
    });
    return [{ kind: "showcase", id: shelf.id, name: shelf.name }, reply];
  },

  "signup-form": async (ctx) => {
    const { fa } = ctx;
    const form = await ctx.tx.form.create({
      data: {
        workspaceId: ctx.workspaceId,
        instagramAccountId: ctx.instagramAccountId,
        isActive: false,
        name: fa ? "ثبت‌نام دوره" : "Course sign-up",
        cancelWord: fa ? "لغو" : "cancel",
        completionMessage: fa ? "ممنون {username}! ثبت‌نامت انجام شد و به‌زودی تماس می‌گیریم." : "Thanks {username}! You're signed up; we'll be in touch.",
        cancelMessage: fa ? "ثبت‌نام لغو شد. هر وقت خواستی دوباره «ثبت نام» بفرست." : "Cancelled. Send “sign up” any time to start again.",
        questions: [
          { id: "name", text: fa ? "اسم و فامیلت؟" : "Your full name?", kind: "text", saveTo: "name" },
          { id: "phone", text: fa ? "شماره موبایلت؟" : "Your mobile number?", kind: "phone", saveTo: "phone" },
          { id: "time", text: fa ? "کدام زمان برایت بهتر است؟" : "Which time suits you?", kind: "choice", choices: fa ? ["صبح", "عصر"] : ["Morning", "Evening"] },
        ],
      },
    });
    const start = await command(ctx, {
      name: fa ? "شروع ثبت‌نام" : "Start sign-up",
      keywords: fa ? ["ثبت نام", "ثبت‌نام"] : ["sign up", "register"],
      responses: [text(fa ? "عالی! سه سؤال کوتاه دارم. هر وقت خواستی «لغو» بفرست." : "Great! Three short questions. Send “cancel” any time.")],
      formId: form.id,
    });
    return [{ kind: "form", id: form.id, name: form.name }, start];
  },

  "follow-up": async (ctx) => {
    const { fa } = ctx;
    const sequence = await ctx.tx.sequence.create({
      data: {
        workspaceId: ctx.workspaceId,
        instagramAccountId: ctx.instagramAccountId,
        isActive: false,
        name: fa ? "پیگیری مشاوره" : "Consultation follow-up",
        stopOnReply: true,
        steps: [
          { delayMinutes: 60, response: text(fa ? "سلام {username}، سؤالی دربارهٔ مشاوره داشتی؟" : "Hi {username}, any questions about the consultation?") },
          { delayMinutes: 20 * 60, response: text(fa ? "تا امشب ظرفیت مشاورهٔ رایگان باز است؛ برای رزرو «رزرو» بفرست." : "Free consultation slots are open until tonight; send “book” to reserve.") },
        ],
      },
    });
    const start = await command(ctx, {
      name: fa ? "مشاوره" : "Consultation",
      keywords: fa ? ["مشاوره"] : ["consultation"],
      responses: [text(fa ? "مشاورهٔ اول رایگان است. ساعت کاری ما ۱۰ تا ۱۸ است." : "The first consultation is free. We work 10:00–18:00.")],
      sequenceId: sequence.id,
    });
    return [{ kind: "sequence", id: sequence.id, name: sequence.name }, start];
  },

  "comment-giveaway": async (ctx) => {
    const { fa } = ctx;
    const campaign = await ctx.tx.automation.create({
      data: {
        workspaceId: ctx.workspaceId,
        instagramAccountId: ctx.instagramAccountId,
        isActive: false,
        name: fa ? "قرعه‌کشی (نمونه)" : "Giveaway (sample)",
        matchAnyPost: true,
        keywords: fa ? ["شرکت"] : ["join"],
        requireFollow: true,
        dmMessage: fa ? "ثبت شد {username}! 🎉 نتیجه جمعه اعلام می‌شود." : "You're in, {username}! 🎉 Winners are announced Friday.",
        publicReplyEnabled: true,
        publicReplyMessages: fa
          ? ["دایرکت رو چک کن 📩", "پیام دادیم، دایرکت رو ببین 🙌", "ثبت شد! جزئیات در دایرکت ✨"]
          : ["Check your DMs 📩", "Sent you a DM 🙌", "You're in! Details in your DMs ✨"],
      },
    });
    return [{ kind: "campaign", id: campaign.id, name: campaign.name }];
  },
};

export async function applyTemplate(key: TemplateKey, { workspaceId, instagramAccountId, locale }: { workspaceId: string; instagramAccountId: string; locale: Locale }) {
  return prisma.$transaction((tx) => BUILDERS[key]({ tx, workspaceId, instagramAccountId, fa: locale === "fa" }));
}

export function hrefFor(created: Created): string {
  switch (created.kind) {
    case "command":
      return `/commands/${created.id}`;
    case "showcase":
      return `/showcases/${created.id}`;
    case "form":
      return `/forms/${created.id}`;
    case "sequence":
      return `/sequences/${created.id}`;
    case "campaign":
      return `/campaigns/${created.id}/edit`;
  }
}
