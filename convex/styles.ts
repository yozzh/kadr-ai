import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { parseThreadState } from "./supervisorState";

export const STYLE_CATALOG = [
  {
    styleId: "paper-ink", label: "Paper & Ink Diagrams", oneLiner: "Flat ink diagrams on warm paper; icons not paragraphs.",
    paletteRule: "bg=paper cream; ink=near-black; accent=one coral/blue; mute=warm gray; warn=muted red (role only)",
    compositionApproach: "flat vector / swiss-grid motifs; generous margins; one focal graphic",
    promptPrefix: "Vertical 9:16 infographic panel for a phone pitch slide, canvas intent 1080x1920, with generous margins that keep the focal graphic inside the central safe band away from top and bottom UI chrome. Warm paper cream background, near-black ink, and exactly one accent color used sparingly. Flat vector diagram language with swiss-grid clarity and one focal graphic only. Prefer icons, nodes, connectors, and simple diagrams over decoration. No small paragraph text inside the image, no fake logos, no photoreal faces, no brand mashups, no muddy gradients, no laptop-with-deck screenshots, and no multi-panel collage. Consistent soft daylight shading, high legibility on a phone OLED, empty designed region that feels like a single illustration plate reusable across the whole deck.",
  },
  {
    styleId: "dark-precision", label: "Dark Precision Motifs", oneLiner: "Minimal dark-surface geometry with one indigo accent.",
    paletteRule: "bg=#222326 Nordic Gray (Linear published); ink=#F4F5F8 Mercury White; accent=desaturated blue (commonly cited #5E6AD2 — verify vs Linear marketing; Linear brand page states desaturated blue reserved for backgrounds); mute=cool gray; warn=soft red",
    compositionApproach: "minimal geometric / product-UI abstraction; hairline shapes; one focal object",
    promptPrefix: "Vertical 9:16 single focal graphic on a near-black Nordic Gray surface for a phone-first founder pitch, composition intent 1080x1920, with generous margins reserved for Reels TikTok Shorts chrome. Off-white geometric shapes, hairline clarity, and one subtle desaturated blue accent only. Minimal product-precision motif language: cards, rings, nodes, progress stubs, never a full SaaS dashboard. Consistent cool lighting across the plate. No photoreal faces, no fake logos or wordmarks, no paragraphs of text inside the image, no neon cyber sludge, no rainbow gradients, no screenshot of software UI. One clean abstract object or diagram plate that can repeat consistently across eight to fourteen slides in the same deck.",
  },
  {
    styleId: "bold-primitives", label: "Bold Primitive Cluster", oneLiner: "Jumbo vector primitives overlapping like a product canvas.",
    paletteRule: "bg=light or dark scheme; ink=high contrast; accent=vibrant primary pair; mute=earthy secondary; warn=hot neon sparingly",
    compositionApproach: "vector primitives; overlap / cluster / reveal compositions (Figma Brand Studio language)",
    promptPrefix: "Vertical 9:16 brand-illustration panel for phone viewing, 1080x1920 intent, one focal composition built from jumbo vector primitives. Bold graphic shapes, oversized nodes, and tonal vibrancy between a limited primary color pair inside an adaptive light or dark scheme that stays consistent for the whole project. Use overlap or cluster composition with generous margins and a single hero graphic. No photoreal faces, no fake logos, no small paragraph text, no screenshot of software UI, no muddy gradient sludge, no 16:9 widescreen collage energy. Flat vector, crisp edges, phone-first clarity, motifs reusable so every placeholder feels like the same visual language.",
  },
  {
    styleId: "soft-product", label: "Soft Product Icons", oneLiner: "Friendly rounded icons and soft slabs on light surfaces.",
    paletteRule: "bg=off-white; ink=slate; accent=blurple/violet; mute=cool gray; warn=amber",
    compositionApproach: "flat rounded vector icons; soft shadows optional but light; one focal cluster",
    promptPrefix: "Vertical 9:16 soft product illustration for a founder pitch on a phone, 1080x1920 intent, off-white background, slate ink, and a single blurple accent. Rounded flat vector icons and friendly soft shapes arranged as one focal graphic cluster in the center safe band, with generous margins. No photoreal faces, no fake customer logos, no paragraphs of text inside the image, no dense analytics dashboard, no neon glow, no isometric city spam. Consistent soft studio lighting, clean empty-safe composition, and a motif kit that can repeat across the deck so images look like one product story rather than random stock icons.",
  },
  {
    styleId: "blueprint-grid", label: "Blueprint Isometrics", oneLiner: "Modular geometric / isometric system diagrams on a grid.",
    paletteRule: "bg=cool paper or slate; ink=deep blue/slate; accent=1 bright signal; mute=grid gray; warn=signal orange",
    compositionApproach: "flat 2D geometric OR consistent isometric; spherical/isometric/diagonal grid logic (studio case studies)",
    promptPrefix: "Vertical 9:16 technical infographic for phone, 1080x1920 intent, modular geometric illustration sitting on a visible soft grid. Prefer flat vector or a consistent isometric perspective, a limited three-color palette, and one focal system diagram with generous margins. Explain structure with shapes and connectors rather than words. No photoreal faces, no fake logos, no paragraphs of text, no laptop showing a pitch deck, no mixed warped perspectives, no exploded clutter. Crisp edges, repeatable motif kit, phone-readable focal graphic that stays legible when the slide is watched full-screen in a vertical feed.",
  },
  {
    styleId: "poster-hook", label: "Poster Motif", oneLiner: "One oversized symbol on high-contrast ground for hook frames.",
    paletteRule: "bg=solid high-contrast; ink=inverse; accent=single hot accent; mute=unused; warn=accent-as-alarm",
    compositionApproach: "editorial poster; single motif; lots of negative space",
    promptPrefix: "Vertical 9:16 poster-style graphic for a scroll-stopping phone frame, 1080x1920 intent, one oversized symbolic motif centered in the safe middle band with huge negative space and high-contrast flat color plus a single accent. No paragraphs of text, no tiny captions, no fake logos, no photoreal faces, no busy collage, no multiple competing focal points. Designed for Reels Shorts TikTok viewing with generous margins away from top and bottom UI chrome so the motif remains visible when platform overlays appear. Keep the plate simple enough to regenerate consistently across hook stakes and CTA beats.",
  },
] as const;

export const listStyles = () => STYLE_CATALOG.map(({ styleId, label, oneLiner }) => ({ styleId, label, oneLiner }));

export const setStyle = internalMutation({
  args: { userId: v.string(), projectId: v.id("projects"), jobId: v.id("jobs"), styleId: v.string() },
  handler: async (ctx, args) => {
    const [project, job] = await Promise.all([ctx.db.get(args.projectId), ctx.db.get(args.jobId)]);
    if (!project || !job || project.userId !== args.userId || job.userId !== args.userId ||
      job.projectId !== args.projectId || job.kind !== "supervisor" || job.status !== "running") {
      throw new ConvexError("NOT_FOUND");
    }
    if (project.status !== "slides_ready" || parseThreadState(project.langgraphThreadState).activeSkill !== "fill_placeholders") {
      throw new ConvexError("TOOL_NOT_AVAILABLE");
    }
    const selected = STYLE_CATALOG.find((style) => style.styleId === args.styleId);
    if (!selected) throw new ConvexError("STYLE_UNKNOWN");
    if (project.infographicStyle?.styleId === selected.styleId) {
      return { style: project.infographicStyle, styleRevisionId: project.styleRevisionId };
    }
    const style = { ...selected, catalogVersion: 1 as const };
    const styleRevisionId = `style_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await ctx.db.patch(project._id, { infographicStyle: style, styleRevisionId });
    return { style, styleRevisionId };
  },
});
