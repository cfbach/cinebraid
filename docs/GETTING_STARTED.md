# Getting started with CineBraid 6.6.5 Private Test 1

CineBraid requires **Node.js 18 or newer** and stores the approved truth of a production. You can bring in images, video, and audio made anywhere; organize them; assign continuity; attach them to shots; and mark the final result. AI and generation are optional.

## 1. Start and open the sample

Run:

```bash
npm start
```

Open `http://127.0.0.1:4477`, then choose **CineBraid Sample — The Blue Parcel**.

The sample contains no real production material and needs no provider.

The sample is intentionally **instructive rather than pristine**. Project Readiness begins with two deliberate items: the Blue parcel needs a canon description, and the third shot needs an explicit duration. These are teaching prompts, not missing package files.

## 2. Inspect approved references

Open **References → Approved**.

You will see:

- the courier’s primary and Profile authorities;
- the rain platform and its matching reverse view;
- the blue parcel in Closed and Opened states.

Open an item to see how views and states can be marked **Required**, **Planned**, or **Not required**.

## 3. Practice importing an authority

On a reference item:

1. Select **Upload reference files**.
2. Select **Map imported references**.
3. Choose the uploaded file and its exact destination: primary authority, angle/view, expression, or state.
4. Select **Map & assign**.

Human approval is sufficient. An optional AI check can be run separately when configured.

## 4. Finish the sample’s third shot

Open **Production**, then **Parcel opened**.

1. In **Frames**, choose the existing `SAMPLE-03-OPEN.png` image and approve it as Frame A.
2. In **Deliver**, finalize the approved still.
3. Return to Production and confirm the shot is complete.

This proves the core workflow without prompts, generation, or automation.

## 5. Clear a readiness item

Open **Production → Project Readiness**, then open **Blue parcel has no canon text**.

1. Choose **Details & history → Details**.
2. In **Canon description**, write a short locked description of the parcel: its blue box, pale straps, proportions, and which details must remain the same when it opens.
3. Return to Production and open Project Readiness again.
4. Confirm the shared entity warning has cleared for every shot at once.

The remaining sample item points to **Parcel opened**. Add an explicit duration in the shot workspace when you want to practice clearing the second item.

## 6. Create your own project

Create a project and follow the same order:

1. Add scenes and shots.
2. Upload and approve recurring characters, locations, props, and vehicles.
3. Map useful states and views; mark unneeded coverage Not required.
4. Link approved authorities in each shot’s **Inputs** stage.
5. Add existing blocking, frames, video, and audio.
6. Approve and finalize the chosen result.

## Optional assisted tools

Prompt building, AI review, FAL generation, and bounded automation are collapsed in manual-first projects. Open them only when useful, or change **Settings → Project → Workspace emphasis** to Assisted production.

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
- **Automate Full Shot** reuses approved references and existing blocking, generates only what remains missing, reviews each required frame, and approves strong passes parent-first.
- Enable **Review scene after completion** in the planner to compare the assembled scene against the Project Bible and approved character, location, prop, and vehicle authorities.
- Use **Scene continuity & automation** to open the scene workspace, where you can review current approved stills or automate unfinished shots and bounded continuity repairs.

Full-shot and scene automation generate still images only. Motion and video remain a separate deliberate step.
