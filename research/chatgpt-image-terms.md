# ChatGPT image terms and limits (≈30 Captain portraits, ChatGPT web UI)

Ticket: [ChatGPT image terms and limits #22](https://github.com/abdullah12353/orc-simulator/issues/22). Builds on [Portrait pipeline #18](https://github.com/abdullah12353/orc-simulator/issues/18): 30 base portraits at 512×640, lossy WebP with transparency, overlays combined in the browser, made by Mohammed in the ChatGPT web UI and touched up by hand to fit the template face box.
Researched: 2026-10-29. Every source below was **accessed on 2026-10-29**. Where a page shows its own date, it's given. Help-center pages only show relative dates ("Updated: yesterday"), so those are converted to absolute dates from the access date.
Sources are OpenAI's own pages only: the Terms of Use, Usage Policies, Service Terms, Sharing & Publication Policy, the Model Spec, the ChatGPT pricing page, help-center articles, release notes, the Images 2.5 system card and the official API docs. Anything that is my reading rather than the source's words is marked **INFERENCE**. Anything the sources don't settle is marked **UNCERTAIN**.

Scope reminder: Claude generates no images. Mohammed generates them; this note only covers what OpenAI's terms and documented limits say about doing that.

**TL;DR**

- **Ownership:** Mohammed **owns the Output**, and OpenAI "hereby assign[s]" him any rights it has. Both the rest-of-world and the Europe (EEA/Switzerland/UK) terms say so, in the same words. Nothing in the terms limits image Output to non-commercial use. The only Output carve-out is **ChatGPT Voice Output** (non-commercial only), which doesn't affect us. A private friends' PWA on Cloudflare Pages is fine.
- **Two strings attached:** don't **represent the portraits as human-made**, which is a listed prohibition, and remember Output "may not be unique". A one-line credit ("Portraits: AI-generated with ChatGPT Images, edited by Mohammed") covers the first.
- **Content policy:** grotesque, crude, bandaged, masked, bucket-helmeted orc busts are cartoon fantasy violence at most, and nothing in the Usage Policies or Model Spec targets them. The real tripwires are **extreme gore**, **real people's likenesses**, **third-party IP** (no "Shadow of Mordor", "Warcraft" or "Warhammer" in prompts), and **ethnic or national caricature**, which the tone bible already bans. The tone bible's swearing and innuendo live in text and audio, not in the portraits.
- **Limits:** Free is "Limited image creation" and Plus is "More complex and accurate image creation" plus **Images with thinking**. **OpenAI publishes no number for either.** Free also caps uploads at **3 files per day**, which strangles a reference-image workflow. **Plus ($20/month)** allows 80 files every 3 hours and 25 project files.
- **Resolution and format:** ChatGPT "can… make the background transparent" and does "any aspect ratio". **512×640 can't be generated natively**: the API's pixel floor is 655,360 pixels and 512×640 is 327,680. Ask for **4:5 portrait** and downscale. The UI's download format and pixel size **aren't documented** (UNCERTAIN), so check the first download for a real alpha channel.
- **Consistency:** the documented tools are **reference images with assigned roles**, **"change only X" edits**, the **selection editor**, **Project instructions** (which override custom instructions) and **custom instructions** (5,000 characters on Plus). OpenAI's own docs admit the model "may occasionally struggle to maintain visual consistency for recurring characters". **New custom GPTs can't be created on personal plans.**
- **Data:** on Free and Plus, **training is on by default**. Turn off **Settings → Data controls → Improve the model for everyone**, or use **Do not train on my content** in the Privacy Portal. Uploaded images follow the same rule as text. **Don't give thumbs-up or thumbs-down** on images: feedback can put the whole conversation into training even after opting out.
- **Verdict:** **go**, on **one month of Plus**, with training switched off, inside one Project, and with a hand-made alpha and resize pass budgeted per portrait.

---

## 1. Ownership and use

| Fact | Source |
|---|---|
| "As between you and OpenAI, and to the extent permitted by applicable law, you (a) retain your ownership rights in Input and (b) own the Output. We hereby assign to you all our right, title, and interest, if any, in and to Output." | [Terms of Use (rest of world), published and effective 1 Jan 2026](https://openai.com/policies/row-terms-of-use/); same wording in [Europe Terms of Use, updated 16 Jan 2026](https://openai.com/policies/eu-terms-of-use/) |
| Which terms apply: "If you reside in the European Economic Area, Switzerland, or the UK, your use of the Services is governed by [the Europe terms]". The Europe terms cover "personal, non-commercial use of our Services by consumers" and have a separate "Business use of the Services addendum" for commercial use (liability, indemnity, governing law). | same two pages |
| "Output may not be unique and other users may receive similar output from our Services. Our assignment above does not extend to other users' output". | both Terms |
| Prohibited: "Represent[ing] that Output was human-generated when it was not." Also "Automatically or programmatically extract[ing] data or Output", and "Using Output to develop models that compete with OpenAI". | both Terms |
| "You must evaluate Output for accuracy and appropriateness for your use case, including using human review as appropriate, before using or sharing Output". | both Terms |
| The only Output carve-out in the Service Terms is voice: "ChatGPT Voice Output is for non-commercial use only… Any rights in Output assigned to you do not include ChatGPT Voice Output." For images, it says "You may not use Visual Capabilities to reproduce the likeness of any person without express consent and all necessary rights." | [Service Terms, updated 16 Oct 2026](https://openai.com/policies/service-terms/), §§ 6, 8 |
| Sharing: "Attribute the content to your name or your company" and "Indicate that the content is AI-generated in a way no user could reasonably miss". This is written for social media and livestreams, and for API co-authored *written* content. | [Sharing & Publication Policy, updated 14 Nov 2022](https://openai.com/policies/sharing-publication-policy/) |
| Provenance: "Images generated with ChatGPT, Codex, or the OpenAI API include both signals", Content Credentials (C2PA) and SynthID. C2PA "can be lost through everyday actions, such as taking a screenshot or converting a file". A watermark "does not establish who authored or owns the content". | [Help: Provenance signals, updated 28 Oct 2026](https://help.openai.com/en/articles/8912793-provenance-signals-in-openai-generated-content) |

**INFERENCE:**
- The ownership clause is the same in both versions, so it doesn't matter which one governs Mohammed.
- Nothing in the Terms, Service Terms or Usage Policies restricts *where* image Output is published, or limits it to non-commercial use. A private, non-commercial PWA on Cloudflare Pages is the low-risk end of what's allowed.
- If the game ever became commercial, the Europe terms' business addendum would kick in for him as a user. It changes liability and law, not ownership.
- Converting to WebP and hand-editing will probably strip the C2PA manifest, while SynthID may survive. Nothing requires keeping either.
- An in-app credit line meets both the "not human-generated" rule and the spirit of the 2022 sharing policy.

**UNCERTAIN:**
- "To the extent permitted by applicable law" and "if any" mean OpenAI only hands over whatever rights exist. **Whether copyright subsists in AI-generated images at all is a question of national law, which OpenAI's documents don't answer.** For a private game this matters little in practice, and Mohammed's hand edits strengthen any claim. Taking legal advice is out of scope.
- The Sharing & Publication Policy dates from 2022 and predates image generation in ChatGPT. Whether it formally applies to images in an app is unclear, so the credit line is cheap insurance.

---

## 2. Content policy: will it draw grotesque, crude, bandaged, masked orcs?

### 2.1 What the rules say

| Fact | Source |
|---|---|
| The version in force on 2026-10-29 bans, among others: "threats, intimidation, harassment, or defamation"; "terrorism or violence, including hate-based violence"; "attempts to infringe on intellectual property rights of others"; "use of someone's likeness, including their photorealistic image or voice, without their consent in ways that could confuse authenticity"; "circumventing our safeguards". | [Usage Policies, effective 29 Oct 2025](https://openai.com/policies/usage-policies/revisions/2025-10-29/) |
| The next version is "effective November 20, 2026". Per its changelog it clarifies model-training restrictions, child and teen protections, high-stakes uses, national-security uses and model-access intermediaries. The bullets quoted above are worded identically in it. | [Usage Policies (latest), effective 20 Nov 2026](https://openai.com/policies/usage-policies/) |
| "GPT should not generate erotica, depictions of illegal or non-consensual sexual activities, or extreme gore, except in scientific, historical, news, artistic or other contexts where sensitive content is appropriate. This includes depictions in text, audio… or visual content." | [Model Spec, 2026-10-29](https://model-spec.openai.com/2026-10-29.html), "Don't respond with erotica or gore" |
| "GPT must not generate hateful content targeting protected groups (race, religion, gender, sexual orientation, disability, etc.). This includes slurs, insults, and any language that demeans or dehumanizes." | same, "Avoid hateful content directed at protected groups" |
| "GPT must respect creators, their work, and their intellectual property rights". | same, "Respect creators and their rights" |
| "Profanity is appropriate only when the context or instruction supports it." | same |
| Enforcement has four layers: "Upstream Refusals" (LLM policy checks on the request), "Input blocking" (text and uploaded images), "Output blocking" (the finished image is checked "before it is shown to the user"), and offline review, which can suspend accounts. | [ChatGPT Images 2.5 System Card, published 8 Sep 2026](https://deploymentsafety.openai.com/chatgpt-images-2-5) §3.2 |
| The adversarial "Violence / Gore" category is evaluated separately. Images 2.5 "generally performs on par with or better than GPT Images 2.0". | same, §3.3 |
| "We use automated systems and human review to identify and address content that violates our Terms… we may remove or restrict content, limit your access to features, or suspend or terminate your account." | [Europe Terms of Use](https://openai.com/policies/eu-terms-of-use/), "Content moderation" |

### 2.2 The tone bible against those rules

| Portrait element (#18, [tone bible](../.scratch/orc-nonsense/tone-bible.md)) | Risk | Why (INFERENCE unless quoted) |
|---|---|---|
| Grotesque, ugly, warty orc faces; a lost tusk | **Low** | Fantasy creature design. No rule touches ugliness in a fictional non-human. |
| Head and mouth bandages, eyepatch, "mummy" wraps | **Low** | Comic injury dressing with no wound shown. |
| Bucket helmet, wig, fake moustache, disguises, masks | **Low** | Crude gear is props, not policy. |
| Hook hand, crude weapons on a bust | **Low** | Depicting a fictional weapon isn't "weapons development, procurement, or use". |
| Blood, open wounds, severed parts, "deid" (dead) | **Medium to high** | It edges towards "extreme gore". Keep injuries implied (bandage, sling, stitches) and leave blood out of prompts. The portraits don't need it. |
| Profanity or slogans painted on gear | **Medium** | Text in the image is judged like text. Not needed: portraits carry no words (#18). |
| A Captain looking like a real politician or celebrity ("Brexit geezer" register) | **High** | Likeness rule plus Service Terms §6. The tone bible already says "no real politicians". Keep Brexit to the *text*. |
| An accent archetype drawn as ethnic or national features or dress (e.g. Indian English, Glaswegian) | **High**, and against the tone bible | Hateful-content rule, plus the tone bible's swap test ("identity is never the joke"). Prompt traits and gear only, never ethnicity. |
| "In the style of Shadow of Mordor / Warcraft / Warhammer" | **Medium to high** | IP rule. Describe the look (materials, palette, line) without naming franchises or living artists. |
| Sexual innuendo ("your mum" jokes) | n/a | Text only. Women never appear (tone bible §4), so there's nothing to draw. |

**Verdict:** the busts as #18 specifies them are well inside the rules. Refusals are most likely from *wording*, not from the subject. "Gory", "bloody", "mutilated", a franchise name, or a real person's name are the words to avoid. **UNCERTAIN:** classifiers aren't published, so expect the odd false-positive block on words like "wounded" or "battered". The fix is rewording, never trying to get around the block, which is itself prohibited ("circumventing our safeguards").

---

## 3. Limits, resolution and format

### 3.1 Plan limits

| Fact | Source |
|---|---|
| Free: "Limited image creation", "Limited messages with uploads". Go: "More image creation". Plus: "More complex and accurate image creation", "Expanded messages and uploads", "Limits apply". Pro: "Unlimited and faster image creation" (subject to abuse guardrails). Comparison table: "Image generation with Thinking" is No on Free and Go, Yes on Plus and Pro. | [ChatGPT pricing](https://openai.com/chatgpt/pricing/) (undated) |
| "ChatGPT Images is available on all tiers. Images with thinking is available on Plus, Pro, and Business." | [Help: Images in ChatGPT, updated 28 Oct 2026](https://help.openai.com/en/articles/11084440-images-in-chatgpt) |
| Free: "File uploads, image generation, voice, data analysis, and other tools have separate usage limits. ChatGPT will notify you when you reach an applicable limit." Upgrading resets them: "your usage rates will reset when you update your account to a Plus plan". | [Help: ChatGPT Free Tier FAQ, updated 29 Oct 2026](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq) |
| Plus: "Price: $20/month (billed monthly)." "Plus subscriptions may include usage limits… especially during high demand." No annual plan. | [Help: What is ChatGPT Plus?, updated 20 Oct 2026](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus) |
| Images 2.5 launch: "Existing image-generation limits are unchanged." | [Release notes, 8 Sep 2026](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) |
| Historical only: a 2024 entry let "ChatGPT Free users… create up to two images per day with DALL·E 3." | same, 2024 entry |
| Uploads: "Images have a limit of 20 MB per image." "You can upload up to 80 files every 3 hours. **Free users are limited to 3 file uploads per day.**" Project files: Free 5, Go and Plus 25, Pro 40. | [Help: Uploading files, updated 29 Oct 2026](https://help.openai.com/en/articles/8555545-file-uploads-faq) |
| Storage: Free 500 MB, Go 4 GB, Plus 20 GB, Pro 100 GB. | [Release notes, 14 May 2026](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) |
| Terms: no "circumvent[ing] any rate limits or restrictions". No sharing your account. | both Terms of Use |

**UNCERTAIN:** **OpenAI publishes no per-day or per-window image count for any plan.** The Free cap is shown in-product when you hit it. Prices on the pricing page load client-side and weren't readable, so $20 comes from the Plus help article.

**INFERENCE:** "generate many, keep 30" probably means 100 to 300 generations plus edits. On Free, with an undisclosed small cap and 3 uploads a day, that's weeks of drip-feeding. One Plus month is the practical plan. Don't open a second Free account to stretch the cap: that would be circumventing limits.

### 3.2 Resolution, aspect ratio, transparency, file format

| Fact | Source |
|---|---|
| "ChatGPT Images can follow instructions to add text, add details within the image, or **make the background transparent**." | [Help: Images in ChatGPT](https://help.openai.com/en/articles/11084440-images-in-chatgpt) |
| "You can also generate images in **any aspect ratio**. Use the aspect ratio picker… or include your desired aspect ratio in your prompt." The editor's "Aspect ratio" option regenerates in another ratio. "Save" downloads to your device. | same |
| API, for the same model family: recommended sizes 1024×1024, 1536×1024, 1024×1536. Custom sizes: "multiples of 16, the aspect ratio must be between 1:3 and 3:1, and neither edge may exceed 3840 pixels. **The total pixel count must be between 655,360 and 8,294,400**." | [API guide: Image generation](https://developers.openai.com/api/docs/guides/image-generation) (undated) |
| API: "The default format is png, but you can also request jpeg or webp." "For transparent backgrounds… set background: \"transparent\" and use output_format: \"png\" or \"webp\"." | same |
| "For transparent assets… **Check the decoded image's alpha channel**, including hair, glass, shadows, and object edges." Prompt example: "clean alpha edges, and no solid backdrop, scenery, checkerboard, or watermark." | [API guide: Image prompting](https://developers.openai.com/api/docs/guides/image-prompting) (undated) |

**UNCERTAIN:** the help center doesn't document the **file format or pixel dimensions of a ChatGPT-UI download**, or whether its transparent output is always a true alpha channel. Check the first saved file.

**INFERENCE:**
- **512×640 can't come out natively.** It is 327,680 pixels, under the documented 655,360 floor, assuming ChatGPT shares the API model's limits. 512×640 is exactly **4:5**, so ask for "4:5 portrait", expect something like 1024×1280, and downscale by exactly 2×. That keeps the template face box geometry clean.
- **WebP is a conversion step on Mohammed's side** (the UI's "Save" format is undocumented). Do the alpha check, the hand touch-up and the downscale on the PNG master, then export lossy WebP with alpha.
- If the alpha comes back as a fake baked-in checkerboard or a fringed edge, the fallback is a flat chroma background keyed out by hand. Use **magenta (#FF00FF), not green**, because orc skin is green.

---

## 4. Keeping one style across 30 portraits

| Documented tool | What the source says | Source |
|---|---|---|
| **Edit an existing image** | "Select an image generated by ChatGPT Images or upload an existing image, then describe the change you want." There's a selection tool, but "Highlights are not always precise, and edits may extend beyond the area you selected." | [Help: Images in ChatGPT](https://help.openai.com/en/articles/11084440-images-in-chatgpt) |
| **Better edit consistency in 2.5** | "The model produces more consistent results when editing images… Users can change an image's setting, style, or composition while retaining more of the details." | [Images 2.5 System Card](https://deploymentsafety.openai.com/chatgpt-images-2-5) §1 |
| **Reference roles** | "Assign roles to references. Identify each input by number and purpose: subject, style, clothing, or background." | [API guide: Image prompting](https://developers.openai.com/api/docs/guides/image-prompting) |
| **Constrained edits** | "Say 'change only X' and list the details to preserve". "Pass the previous output as the next edit input, request one change, and repeat the details to preserve… restate critical constraints if the result drifts." "If a region must remain pixel-identical, composite the approved edit into the original image". | same |
| **Known weakness** | "The model may occasionally struggle to maintain visual consistency for recurring characters or brand elements across multiple generations." | [API guide: Image generation](https://developers.openai.com/api/docs/guides/image-generation), Limitations |
| **Project instructions and files** | "Project instructions apply only within that project and override your global custom instructions." Projects take reference images as files (Plus: 25). A project can use "project-only memory". | [Help: Projects, updated 29 Oct 2026](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) |
| **Custom instructions** | "Applied immediately to all chats." Free and Go 1,500 characters; Plus and above 5,000. | [Help: Custom instructions, updated 27 Oct 2026](https://help.openai.com/en/articles/8096356-custom-instructions-for-chatgpt) |
| **Shared prompts** | You can share "the prompt for a generated image so someone else can create their own version" (mobile: Share → Prompt template). | [Help: Images in ChatGPT](https://help.openai.com/en/articles/11084440-images-in-chatgpt) |
| **No new custom GPTs** | "New GPT creation and publishing are not available on personal ChatGPT accounts, including Free, Go, Plus, and Pro." | [Help: Free Tier FAQ](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq) |
| **Gallery** | All images are saved under Images. Deleting one means deleting its conversation. | [Help: Images in ChatGPT](https://help.openai.com/en/articles/11084440-images-in-chatgpt) |

**INFERENCE (recipe):** one Project called "Orc portraits", with project-only memory. Its instructions hold the fixed style prompt and the template face box brief Claude writes at implementation (#18). Its files hold (1) the face-box template as an image and (2) once approved, a "style anchor" portrait. Each Captain gets a new chat that attaches the anchor as "image 1 = style only", with the per-Captain traits and gear in the prompt. **Seeds aren't exposed in ChatGPT**, so the anchor image plus a word-for-word prompt is the only way to reproduce a style. Keep the prompt text in the repo, the way #19 keeps voice recipes.

---

## 5. Data: do uploads and prompts train models?

| Fact | Source |
|---|---|
| "On personal workspaces with ChatGPT Free, Plus, or Pro, data sharing is **enabled by default**." Turn it off under Settings → Data controls → **Improve the model for everyone** (web, iOS and Android). The setting follows the account when signed in. | [Help: Data controls, updated 26 Oct 2026](https://help.openai.com/en/articles/7730893-data-controls-faq) |
| Or select "**Do not train on my content** in our Privacy Portal. Either option is sufficient… After you opt out, we won't use your **new** conversations to improve our models." | [Help: How your data is used, updated 19 Oct 2026](https://help.openai.com/en/articles/5722486-how-your-data-is-used-to-improve-model-performance) |
| Images are covered: "Our approach to using content, including images, remains the same for each product." | [Help: Image Inputs FAQ, updated 19 Oct 2026](https://help.openai.com/en/articles/8400551-image-generation-in-chatgpt) |
| **Feedback trap:** "if you submit feedback on a response—for example, by selecting thumbs up or thumbs down—we may use the entire conversation associated with that feedback to improve our models, even if you have opted out". | [Help: How your data is used](https://help.openai.com/en/articles/5722486-how-your-data-is-used-to-improve-model-performance) |
| Temporary chat: "not used to improve OpenAI models while it remains temporary", kept "for up to 30 days for safety purposes", out of history, and "Files uploaded in Temporary Chat aren't saved to Library". | [Help: Temporary chat, updated 29 Oct 2026](https://help.openai.com/en/articles/8914046-temporary-chat-faq), [Release notes, 14 May 2026](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) |
| Shared projects (personal accounts) "may be used to improve models only when the project owner and every contributor have Improve the model for everyone turned on." | [Help: Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) |
| Custom instructions: "Information from your use of custom instructions will also be used to improve model performance". | [Help: Custom instructions](https://help.openai.com/en/articles/8096356-custom-instructions-for-chatgpt) |
| Terms: "If you do not want us to use your Content to train our models, you have the option to opt out by updating your account settings." | [Europe Terms of Use](https://openai.com/policies/eu-terms-of-use/) |

**UNCERTAIN:** the custom-instructions article states its training use without mentioning the opt-out. **INFERENCE:** the account-wide opt-out covers it, but putting the style prompt in **Project instructions** rather than global custom instructions avoids the question and keeps it scoped.

**INFERENCE:** turn the opt-out off *before* the first upload, because it only applies to *new* conversations. Use a normal Project, not Temporary chat: Temporary chat loses the history, and with it the edit chain that consistency depends on.

---

## 6. Verdict and session tips

**Verdict: go.** The terms give Mohammed ownership of the portraits, with no non-commercial or hosting restriction on images. The subject is inside policy as long as prompts avoid gore words, real people, franchise names and ethnic cues. The workflow fits **one Plus month ($20)**, while Free's undisclosed image cap and 3 uploads a day make "generate many, keep 30" impractical. The only hard technical gap is that **512×640 and WebP aren't native outputs**: generate at 4:5, check the alpha, downscale 2× and convert by hand.

**Practical tips for the generation session (INFERENCE, built from the sources above):**
1. **Before anything:** subscribe to Plus. Turn off *Improve the model for everyone*, or set *Do not train on my content* in the Privacy Portal. **Never press thumbs up or thumbs down** in these chats.
2. **One Project, "Orc portraits"**, with project-only memory. Put the style prompt and the template box brief in the **Project instructions**. Attach the face-box template image.
3. **Lock the style first:** iterate on 1 or 2 test Captains with *Images with thinking* (Plus) until one portrait is "the anchor". Save it as a project file. Every later chat starts with "Image 1 = style reference only; do not copy its face".
4. **Prompt pattern per Captain:** fixed style block, then "4:5 portrait bust, head and shoulders filling [template box], **transparent background**, no text, no frame, no checkerboard", then traits and baked-in gear (jaw, ears, chin, tusks, scars) taken **from Traits, never from the accent**.
5. **Words to keep out of prompts:** blood, gore, gory, mutilated, severed; any real person; *Mordor/Warcraft/Warhammer/Games Workshop* or a living artist's name; ethnic, national or religious dress or features. Show injury with bandages, stitches and slings.
6. **Leave room for overlays:** generate the bare face (no bucket, wig or bandage). Those are browser overlays (#18). Baked-in identity gear only.
7. **Edits:** for a fix, say "change only X; keep face, palette, line weight, lighting and framing identical". Make one change per turn. If an edit drifts, go back to the last good image rather than stacking fixes.
8. **On the first download, check:** the pixel size, the file type, and **a real alpha channel**, especially at the tusks and ear edges. If the alpha is fake, switch to a flat magenta background and key it out.
9. **Post-processing per keeper:** hand touch-up to fit the box, downscale exactly 2× to 512×640, export lossy WebP with alpha, plus thumbnails. Keep the PNG masters and the exact prompts in the repo.
10. **Hitting a cap or a block:** wait for the in-product reset, or reword. Don't use a second account and don't use jailbreak phrasing: both breach the Terms.
11. **Credit line** in the app's About screen: "Captain portraits AI-generated with ChatGPT Images and edited by hand by Mohammed."
12. **Cancel Plus** before renewal. The images stay in the Images gallery and, once downloaded, in the repo.

**Still open (measure in the session):** the actual Plus image cap, the UI's download format and size, true-alpha reliability, and how well a single style anchor holds across 30 chats.

---

## Sources (all accessed 2026-10-29)

- OpenAI, [Terms of Use (rest of world)](https://openai.com/policies/row-terms-of-use/), published and effective 1 Jan 2026
- OpenAI, [Europe Terms of Use (EEA, Switzerland, UK)](https://openai.com/policies/eu-terms-of-use/), updated 16 Jan 2026
- OpenAI, [Service Terms](https://openai.com/policies/service-terms/), updated 16 Oct 2026
- OpenAI, [Usage Policies (in force)](https://openai.com/policies/usage-policies/revisions/2025-10-29/), effective 29 Oct 2025; [latest](https://openai.com/policies/usage-policies/), effective 20 Nov 2026
- OpenAI, [Sharing & Publication Policy](https://openai.com/policies/sharing-publication-policy/), updated 14 Nov 2022
- OpenAI, [Model Spec](https://model-spec.openai.com/2026-10-29.html), 29 Oct 2026
- OpenAI, [ChatGPT pricing](https://openai.com/chatgpt/pricing/), undated
- OpenAI Deployment Safety Hub, [ChatGPT Images 2.5 System Card](https://deploymentsafety.openai.com/chatgpt-images-2-5), 8 Sep 2026
- OpenAI Help Center (dates converted from "Updated: N days ago"):
  - [Images in ChatGPT](https://help.openai.com/en/articles/11084440-images-in-chatgpt) (28 Oct 2026)
  - [ChatGPT Free Tier FAQ](https://help.openai.com/en/articles/9275245-chatgpt-free-tier-faq) (29 Oct 2026)
  - [What is ChatGPT Plus?](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus) (20 Oct 2026)
  - [What is ChatGPT Go?](https://help.openai.com/en/articles/11989085-what-is-chatgpt-go) (28 Oct 2026)
  - [Uploading files](https://help.openai.com/en/articles/8555545-file-uploads-faq) (29 Oct 2026)
  - [Image Inputs FAQ](https://help.openai.com/en/articles/8400551-image-generation-in-chatgpt) (19 Oct 2026)
  - [Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) (29 Oct 2026)
  - [Custom instructions](https://help.openai.com/en/articles/8096356-custom-instructions-for-chatgpt) (27 Oct 2026)
  - [Data controls](https://help.openai.com/en/articles/7730893-data-controls-faq) (26 Oct 2026)
  - [How your data is used to improve model performance](https://help.openai.com/en/articles/5722486-how-your-data-is-used-to-improve-model-performance) (19 Oct 2026)
  - [Temporary chat](https://help.openai.com/en/articles/8914046-temporary-chat-faq) (29 Oct 2026)
  - [Provenance signals](https://help.openai.com/en/articles/8912793-provenance-signals-in-openai-generated-content) (28 Oct 2026)
  - [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) (entries dated 14 May 2026, 8 Sep 2026, and 2024)
- OpenAI API docs, [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation) and [Image prompting guide](https://developers.openai.com/api/docs/guides/image-prompting), undated. These are used only as INFERENCE about the model behind ChatGPT Images.
