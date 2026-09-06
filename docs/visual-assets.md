# Visual assets — Laboratory Edition

These photorealistic images were created with Codex's built-in `image_gen.imagegen` tool for the Laboratory Edition. They are **AI-generated editorial illustrations**, not photographs of an actual traffic experiment or a measured biological specimen. Visible captions on the site preserve that distinction.

The cellular-automaton diagrams, spacetime plots, traffic plots, and exports are computed from the published simulation code. They do not use generated imagery as data.

## Selected assets

| Asset | Purpose | Dimensions | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| [Traffic study](../assets/images/traffic-study-v2.png) | Introduce the Rule 184 traffic investigation | 1537 × 1023 | 3,124,641 | `e5ffa47368265d75b00ce69a0d1c8de4a98fbf9b5dc96b83ce39b5049b5e09eb` |
| [Shell study](../assets/images/shell-study-v2.png) | Introduce pattern resemblance and the limits of inference | 1536 × 1024 | 2,561,977 | `6a5106d279a6493a0c566d9081b014a6876d3d77d7dba50a7462ab1ed61a1e7d` |

The shell was selected from the first generation. The traffic image received one targeted edit to make the road a single lane and the vehicles a coherent queue. No external reference photographs were supplied. The initial traffic draft is not distributed. The final PNGs retain the tool's output pixels; CSS sizes them for the page.

## Traffic generation prompt

```text
Use case: photorealistic-natural. Asset type: high-resolution editorial photograph for an educational scientific website about traffic flow. Create an extremely realistic professional drone photograph of a closed, circular single-lane traffic research track in a broad quiet field. The road is a credible asphalt ring, one lane wide, with restrained worn white edge markings and a gravel shoulder. A group of ordinary unbranded passenger cars is clustered close together on one portion of the ring while larger gaps appear elsewhere, all aligned tangentially along the road and oriented coherently in one direction. This is an editorial illustration, not a plotted experiment or measured dataset. View from high above at a gently oblique angle so the full ring and believable tiny cars are readable, surrounded by softly textured dry grass, muted olive ground, sparse scrub, and subtle tire wear. Physically convincing scale, correct car geometry, realistic windscreens and cast shadows, grounded photographic detail, natural late-afternoon side light, restrained warm color grading, no excessive HDR. Wide landscape composition suitable for a large feature image, at least 1536 pixels wide, crisp high resolution. No diagrams, no charts, no arrows, no labels, no text, no logos, no watermarks, no futuristic objects, no roads crossing the ring, no overlapping cars. Prioritize convincing real photographic materials and a visually coherent track.
```

## Traffic refinement prompt

The initial traffic output was supplied as the reference image for this edit.

```text
Edit only the road layout and vehicle placement in this existing photorealistic aerial image. Make the circular research track clearly ONE traffic lane, not two: remove every dashed center line, retain only subtle solid white outside edge markings, and position every car in a single centered queue along the asphalt lane. In the clustered right-hand section, cars must follow one another nose-to-tail along one lane, never side by side. Retain larger gaps elsewhere, with coherent one-way orientation around the ring. Preserve the original aerial camera perspective, full closed oval, field and scrub, warm late-afternoon lighting, true-to-life vehicle shapes, natural surface texture, restrained colors, contact shadows and extremely realistic photographic quality. Do not add text, arrows, labels, logos, signs or diagrams. Preserve the landscape composition and resolution.
```

## Shell generation prompt

```text
Use case: photorealistic-natural. Asset type: high-resolution natural-history editorial photograph for an educational website discussing how local processes can form patterns. Create an extremely realistic macro photograph of one intact cone snail shell lying on a dark charcoal stone surface. The shell should have a credible conical natural shape, an intact pointed apex, a subtly irregular lip, fine growth ridges, tiny scuffs, and a rich, intricate cream-and-warm-brown tent-like pigment pattern following the curved shell surface. This is a lifelike editorial illustration, not a specific measured specimen and not the output of a cellular automaton. Photograph the whole shell in a thoughtful horizontal landscape composition with its surface pattern dominating the frame; use soft directional museum-quality lighting, subtle specular highlights on the natural calcium surface, physically correct contact shadow, a restrained shallow depth of field while keeping most of the shell's pattern crisply resolved. Macro lens realism, beautiful minute texture, natural color, high dynamic range without artificial HDR, believable scale. At least1536 pixels wide, very high detail. No live animal, no hands, no display stand, no captions, no letters, no logos, no watermark, no invented scientific overlays, no impossible fractal geometry, no plasticky CGI gloss.
```

## Interpretation limits

- Vehicle spacing in the illustration is composed for explanation, not measured from the Rule 184 model.
- Rule 184 is a discrete one-lane model with unit-speed deterministic motion; it does not establish conclusions about a real road.
- The shell's pigment pattern is synthetic. Its resemblance to a cellular-automaton diagram is not evidence that a particular rule generates a species' pigmentation.
- See [laboratory methods](laboratory-methods.md) for the actual model and [the field guide](../field-guide.html) for sources and reproducible investigations.
