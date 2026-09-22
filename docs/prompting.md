# How to ask for a video

The prompt is the spec. A complete prompt has six parts; the more you give, the fewer guesses
Claude makes and the fewer re-renders you need.

```
Make a demo video of <FEATURE>.

Where:      <URL / area + account>            e.g. the admin area on https://app.test as the admin user
Steps:      1. ... 2. ... 3. ...              what the viewer should see happen, in order
Callouts:   <one short imperative per step>   in the UI's language, matching its labels
Cards:      title "...", subtitle "..."        recap title, intro/recap/outro sections optional
Emphasis:   zoom on <what> during step <n>     only where the UI is small
Output:     mp4 (default) / also gif           slug: <kebab-case>
```

Claude writes the scenario, records, verifies frames, builds the composition, words the
callouts in video.json, checks, renders, and reports the file path with a few extracted frames.

## Example prompts

**A first video for a feature**

> Make a demo video of searching a customer. Admin area on https://app.test as the admin.
> Steps: open Customers, type the first customer's first name in the table search, hover the
> matching row. Callouts: "Open Customers", "Type the name in Search". Title "Find a customer",
> subtitle "Search any customer from the list". Zoom on the search box while typing.
> Slug customers-search.

**A create flow with a modal**

> Demo video: creating a customer. Customers → New customer, fill name/email/phone with a
> persona, save, show the success notification and the new row. One callout per step, zoom on
> the form while filling. Title "Add a customer". Trim the login away.

**A two-actor flow**

> Demo of a document approval: a manager sends a document from the admin area, then the
> employee accepts it in their personal area. One scenario; switch accounts inside
> `demo.transition()` with a "Manager → Employee" card. ~40 s max.

**Through an external payment page**

> Demo of the shop checkout paid by card, no login: product → add to cart → checkout → card
> payment on the gateway's test page with its test card → cut the 3-D Secure wait → success
> page. Accept the cookie banner first. Zoom on the payment-method choice and the card form.

**Re-record after a UI change**

> The customers table got new columns. Re-record <videosDir>/customers-search with the
> existing scenario, re-render with the current video.json, and show me
> frames at each callout.

**Tweak an existing video (no re-record)**

> In <videosDir>/customers-search, change callout 2 to "Search by name or email", make the zoom
> tighter (scale 2.0) and 1 s shorter, then re-render.

**Different output**

> Render <videosDir>/customers-search also as a 15 fps GIF for the README.

**Another intro or outro**

> Render <videosDir>/customers-search with the `minimal` intro, no recap and the `endcard`
> outro, next to the current one so I can compare.

**Narrated recording (manual, OpenScreen)**

> I recorded <videosDir>/onboarding-tour/recording.mp4 myself with OpenScreen, with voiceover.
> Build the composition around it: title "Platform tour", callouts at 0:04 "Main menu",
> 0:12 "Company settings", 0:21 "Invite colleagues". Keep the narration.
