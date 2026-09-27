# Getting started with CineBraid

CineBraid requires **Node.js 18 or newer** and stores the approved truth of a production. You can bring in images, video, and audio made anywhere; organize them; assign continuity; attach them to shots; and mark the final result. AI and generation are optional.

## 1. Start and open the sample

Run:

```bash
npm start
```

Open the local URL printed by the server (normally `http://127.0.0.1:4477`), then choose **Add the CineBraid sample** on the welcome screen. This creates an editable **CineBraid Sample — The Blue Parcel** copy in your projects folder.

The sample contains no real production material and needs no provider.

The sample includes existing media selections that still need explicit human approval.
Readiness prompts identify those decisions; they do not mean files are missing.

## 2. Inspect references

Open **References**. You will see the courier, rain platform and blue parcel, with
candidate images and planned views/states. The **Approved** tab shows only images
with an explicit approval; the shipped sample's existing selections are not approvals.

Open an item to inspect its candidates and decide which reference to approve.
Views and states can be marked **Required**, **Planned**, or **Not required**.

## 3. Practice importing an authority

On a reference item:

1. Select **Upload reference files**.
2. Select **Map imported references**.
3. Choose the uploaded file and its exact destination: primary authority, angle/view, expression, or state.
4. Select **Map & assign**.

Human approval is sufficient. An optional AI check can be run separately when configured.

## 4. Finish the sample’s third shot

Open **Production**, then **Parcel opened**.

1. Choose **Review Frame A result** to open Results for `SAMPLE-03-OPEN.png`. Choose **Approve result…**, then confirm the approval. Frames prepares/imports images; Results records the decision.
2. Open **Deliver**, choose **Mark shot final**, then **Confirm final delivery**.
3. Return to Production and confirm that one shot is delivered.

This proves the core workflow without prompts, generation, or automation.

## 5. Review the remaining decisions

Production may still ask you to confirm the sample's existing reference selections.
Open **Production readiness** or a **Confirm existing reference** action, inspect the
candidate, and approve it only if it is the reference you want the production to use.
Completing the third shot does not approve references or the other shots for you.

## 6. Create your own project

Create a project and follow the same order:

1. Add scenes and shots.
2. Upload and approve recurring characters, locations, props, and vehicles.
3. Map useful states and views; mark unneeded coverage Not required.
4. Link approved authorities in each shot’s **Inputs** stage.
5. Add existing blocking, frames, video, and audio.
6. Approve and finalize the chosen result.

## Optional assisted tools

Prompt building, AI review, generation, and bounded automation are collapsed in manual-first projects. Open them only when useful, or change **Settings → Project → Workspace emphasis** to Assisted production.

**Braidy** is the assistant behind the assisted tools. It says where it stands before it offers to help, and it can run on your own hardware or against a cloud provider — see **Settings → Optional assisted services → Assistant**. With Braidy off, unconfigured or unreachable, everything above this section still works by hand.

Generation can be dispatched to a **local ComfyUI** server on the same machine (no key, no provider cost), to **fal.ai**, or to **Civitai**. Each is configured separately and each is off until you turn it on.

Changing emphasis changes presentation only. The underlying project, prompt compiler, reports, and exports remain the same.

## LAN use

CineBraid is local-only by default. Set an Editor passcode first, then use `npm run start:lan` to share it deliberately on a trusted network.

## Optional blocking automation

Open a shot, choose **Look & blocking**, and expand **Optional assisted blocking**.

- **Build Prompt** creates the grayscale composition prompt. The returned prompt card exposes **Generate** for a manual paid batch.
- **Automate Blocking** runs a bounded blocking-only chain: build, generate, review, revise, retry, and select the best passing guide. It does not generate the finished shot image.
- Generated and uploaded blocking attempts appear together under **Blocking attempts** and remain planning media only.


## Optional full-shot and scene automation

Open a shot, choose **Look & blocking**, and expand **Optional assisted blocking**.

- **AI Review & Recommend** compares all current blocking attempts and recommends the strongest passing composition guide.
- **Use recommended** installs that guide without generating another image.
- **Automate Full Shot** reuses approved references and existing blocking, generates only what remains missing, and reviews each required frame parent-first, recommending the strong passes. It does not approve them: a machine can propose, only a person decides, so the run pauses for your explicit approval on each frame.
- Enable **Review scene after completion** in the planner to compare the assembled scene against the Project Bible and approved character, location, prop, and vehicle authorities.
- Use **Scene continuity & automation** to open the scene workspace, where you can review current approved stills or automate unfinished shots and bounded continuity repairs.

Full-shot and scene automation generate still images only. Motion and video remain a separate deliberate step.
