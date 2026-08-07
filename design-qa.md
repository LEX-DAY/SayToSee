# SayToSee design QA

- Source visual truth: `C:\Users\ange1\AppData\Local\Temp\codex-clipboard-dc2ed20d-520d-455d-9a8a-6d779331d686.png`
- Wails implementation screenshot: `C:\git\CalltoCall\desktop\build\qa-saytosee-wails.png`
- Web implementation screenshot: `C:\git\CalltoCall\desktop\build\qa-saytosee-web.png`
- Full-view comparison: `C:\git\CalltoCall\desktop\build\qa-reference-vs-wails.png`
- Focused brand and form comparison: `C:\git\CalltoCall\desktop\build\qa-focused-brand-card.png`
- State: initial lobby, microphone enabled, camera disabled, server status visible
- Source pixels: 1173 × 760
- Wails implementation pixels/CSS window: 1180 × 760 at 1× density
- Web implementation pixels/CSS viewport: 1180 × 760 at 1× density
- Normalization: source and Wails captures were padded to equal 1180 × 760 columns without scaling before side-by-side comparison

## Full-view comparison evidence

The final Wails capture preserves the reference composition: brand at upper left,
server state and settings at upper right, two-line hero at the same vertical
position, and the form card at the same top edge and width. The annotated/blurred
source areas were treated as removal instructions, so the resulting card is
shorter and the lobby has no eyebrow, explanatory paragraph, resource note, step
badge, WebRTC footnote, capacity card, or footer.

The browser-rendered web lobby uses the same simplified hierarchy and content.
At 1180 × 760 its hero and card align to the content area of the source, and the
camera is disabled by default.

## Focused comparison evidence

The focused comparison shows the replaced brand lockup and the complete form at
native scale. Labels, inputs, switches, button dimensions, radii, border colors,
and spacing follow the reference. The generated SayToSee mark is a real
transparent PNG asset; interface icons come from the existing Lucide family
rather than handcrafted graphics.

## Required fidelity surfaces

- Fonts and typography: Segoe UI/Inter system stack, headline weight, compact
  labels, form hierarchy, line height, and wrapping match the source closely.
- Spacing and layout rhythm: final hero and card positions match after the second
  iteration; card width, field heights, button spacing, and radii are consistent.
- Colors and visual tokens: warm paper background, emerald actions, mint avatar,
  coral brand accent, muted labels, and server-state colors remain coherent.
- Image quality and asset fidelity: the new mark has transparent corners, clean
  antialiased edges, a validated alpha channel, and remains legible in the header.
  The social preview and Windows icon use the same generated mark.
- Copy and content: all visible product branding is SayToSee; requested extra
  lobby copy is removed; Russian labels and actions are consistent across Wails
  and web.

## Interaction and browser checks

- Browser-rendered at `http://127.0.0.1:3001` in the in-app browser.
- Name input, microphone toggle, camera toggle, and invalid-key validation tested.
- Validation correctly showed “Введите ключ встречи из 16 символов”.
- Browser console errors checked: none.
- Production Next.js build, ESLint, Node tests, Go tests, Vite build, npm audit,
  and Wails production build passed.

## Comparison history

1. Initial comparison found the Wails hero approximately 55 px too low and the
   card approximately 17 px too low. The first web capture had the inverse card
   offset and camera enabled by default.
2. Fixed the desktop hero/card offsets, aligned header padding, aligned the web
   hero/card to the source content area, removed the decorative headline stroke,
   and made camera disabled by default.
3. Recaptured Wails and web at 1180 × 760. No actionable P0, P1, or P2 visual
   differences remain. The reduced card height is intentional because the
   annotated source explicitly removes those sections.

## Findings

No actionable P0, P1, or P2 findings remain.

## Follow-up polish

- P3: the detailed two-person brand mark is slightly denser than the previous
  symbol at very small sizes, but it remains recognizable and readable at the
  current 39 × 32 px header slot.

final result: passed
