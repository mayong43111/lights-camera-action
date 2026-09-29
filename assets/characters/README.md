# Bundled character models

## In-studio customizable humans

- `human/female.glb` and `human/male.glb` are generated from official MakeHuman Community **CC0 data only**. No MakeHuman/MPFB/Blender application code is bundled or required.
- Base mesh, rig, weights and shape target data: https://github.com/makehumancommunity/makehuman at `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`. The source asset license is retained in `human/LICENSE.md`; the rig and weights also explicitly state CC0. The creator uses 44 linked morphs: the original eight plus 36 appended targets supporting 20 bidirectional body/face controls defined in `src/creator-shapes.json`. Original morph indices are preserved for saved recipes.
- Hair, two outfits per body, shoes, eyes and eyebrows: https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html. The official pack lists these assets as CC0; extracted asset headers retain the September 2020 CC0 release notice and original attribution.
- `human/source.json` records source revision, individual source hashes and the official system archive hash. The full 268 MB archive is not bundled. The selected original data is retained for reproducible conversion.
- Conversion uses Three.js OBJLoader, BufferGeometry utilities and GLTFExporter. It retains source skin weights, recomputes body-specific bone anchors, fits wearable proxy mappings to the same body/shape targets, removes covered body triangles per outfit, and embeds the default selectable parts. Textures are local companion files loaded before switching characters.
- The default base is the official adult Asian female/male target. This is a limited starting collection, not arbitrary anatomy generation or automatic fitting of third-party clothes. Face controls are actual authored shape targets, not expressions or overall mesh scaling. Color controls tint existing textures.
- CharacterStudio's default Anata female body was not adopted: its embedded VRM metadata says `OnlyAuthor`, `commercialUssageName: Disallow`, and `Redistribution_Prohibited`. Its application's code license does not authorize model redistribution.

To reproduce, download the linked official CC0 system ZIP, then run from the repository root (the preparation script uses the requested local HTTP proxy without disabling TLS):

```powershell
node scripts/prepare-character.mjs "C:\path\makehuman_system_assets_cc0.zip"
node scripts/build-character.mjs
```

The generated model is loaded by the existing three-vrm normalized humanoid adapter. Saving creates an ordinary character recipe; GLB export includes the selected skinned meshes, current morph weights and textures, not VRM extensions or animation clips.

## VRM specification samples

These original, unmodified VRM files and preview images come from the official VRM specification sample collection:

- `pixiv.vrm`, `pixiv.jpg`: VRM1_Constraint_Twist_Sample, (c) 2022 pixiv Inc.
  Source: https://github.com/vrm-c/vrm-specification/tree/master/samples/VRM1_Constraint_Twist_Sample
- `seed.vrm`, `seed.png`: Seed-san, VirtualCast, Inc.
  Source: https://github.com/vrm-c/vrm-specification/tree/master/samples/Seed-san

Each avatar retains its embedded creator and license metadata. Model licensing is separate from the application and from the MIT-licensed three-vrm library.

License: VRM Public License 1.0, https://vrm.dev/licenses/1.0/

No endorsement by the original creators is implied. Users must follow the permissions embedded in each model and the linked license when reusing or redistributing the assets or images created with them.

## Male and female white mannequins

- `mannequin.glb`: derived from Quaternius `Superhero_Male_FullBody`.
- `mannequin-female.glb`: derived from Quaternius `Superhero_Female_FullBody`.
- Official pack and CC0 declaration: https://quaternius.com/packs/universalbasecharacters.html
- License: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/
- Fixed source copy: https://github.com/doyler34/zombie-outbreak/tree/c6f2009ad7a58b8abf455eb15af55a51194e53b5/assets/characters/universal_base

The official itch.io download was unavailable from this environment, so the fixed public copy was used. Each model was built from the corresponding `.gltf` and `.bin` files. Meshes and skin weights are retained; external textures were removed, materials replaced with a neutral white surface, and the data packed into a standalone GLB. These are human base meshes, not photorealistic scans or newly authored robots.

[src/mannequin.ts](../../src/mannequin.ts) maps the source skeleton, aligns the arm rest pose, and uses three-vrm's normalized humanoid rig for existing FK/IK controls. No original VRM metadata is claimed for these glTF assets.

`mannequin.png` and `mannequin-female.png` are 320 x 400 renders of the corresponding models with the same neutral stance, lighting and frontal framing. They contain no studio UI or floor markers and use the same CC0 asset terms.

## Original Universal Animation Library mannequin

- `quaternius-original.glb`: the original orange/purple mannequin from Quaternius Universal Animation Library **Standard**, not Universal Base Characters and not the second animation library.
- Official pack: https://quaternius.com/packs/universalanimationlibrary.html
- Official free download: https://quaternius.itch.io/universal-animation-library
- License: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/
- Downloaded through the user's local HTTP proxy on 2026-09-26. Archive: `Universal Animation Library[Standard].zip`; source member: `Unreal-Godot/UAL1_Standard.glb` (non-root-motion variant).
- The official GLB contains 43 clips including `A_TPose`. The model-only derivative was generated with Three.js 0.180.0 `GLTFExporter`, using `binary: true` and no exported animations. Its two skinned primitives, 65-bone skin, original vertex data and `M_Main` / `M_Joints` materials are retained. No external texture or animation download is needed at runtime.
- Size: 629,852 bytes. `quaternius-original.png` is a 320 x 400 front render of this same asset. The existing normalized-humanoid adapter provides 51 editable joints and FK/IK, placement and project support; the model is not a new animation playback feature.

| Artifact | SHA-256 |
| --- | --- |
| Official Standard ZIP | `cc73fc4e495b82958207316596317a3f40b9fa38065bde1027937452da537724` |
| Official source GLB | `69591853d817488edaa8fd9bf8fc1d821eaeaf789f8627b3cd23b41c4ed67997` |
| Model-only derivative | `15257f2763eefeef41f2c544d9093145350fa055a04ca4f9d0aaf3bcf4553e6e` |

The older community mirror inspected during research is **not** the source of this model or the 43 built-in pose samples. Every official Standard clip, including `A_TPose`, has one categorized static sample in `assets/poses/library.json`; entries retain the source clip, timestamp, license and GLB hash. Conversion and validation are documented in [the pose report](../../tests/QUATERNIUS_TRIAL.md).

## VRoid Studio A / B / C

Status: rejected trial assets, withdrawn from the character picker due to pose and visual-quality issues. Files and IDs are temporarily retained for saved-project compatibility; these models have not passed visual acceptance.

- `vroid-a.vrm`: AvatarSample_A by VRoid / pixiv Inc. Original listing: https://hub.vroid.com/en/characters/2843975675147313744/models/5644550979324015604
- `vroid-b.vrm`: AvatarSample_B by VRoid / pixiv Inc. Original listing: https://hub.vroid.com/en/characters/7939147878897061040/models/2292219474373673889
- `vroid-c.vrm`: AvatarSample_C by VRoid / pixiv Inc. Original listing: https://hub.vroid.com/en/characters/1248981995540129234/models/8640547963669442173

These are VRoid sample models, not CC0 assets. Official conditions, checked on 2026-09-26:

- Conditions: https://vroid.pixiv.help/hc/en-us/articles/4402394424089
- Sample license overview: https://vroid.pixiv.help/hc/en-us/articles/4402614652569

The conditions allow use as avatars in VRM applications, photography/video, modification, and free redistribution. Restrictions include charging for redistribution of the model files or their contained image data, relabeling the assets as CC0, using their data in a character-creation service, and implying pixiv endorsement. Additional prohibited-conduct rules apply; consult the full official conditions before reuse. A paid asset bundle or character generator would require a separate licensing review.

The VRM files were obtained from the community mirror below, not directly downloaded from VRoid Hub. They retain the mirror's original bytes and embedded metadata. The embedded VRM 0 metadata lists author `VRoid` and license `Other`, with an empty license URL; this does not waive the official conditions above.

Pinned download source: https://github.com/madjin/vrm-samples/tree/e16eb187100149a315ad92c3c9968f1d5baa6c7d/vroid/stable

The corresponding `vroid-a.png`, `vroid-b.png`, and `vroid-c.png` previews are 320-pixel derivatives of the thumbnails embedded in those files, under the same model conditions. Original in-model textures are unchanged.

SHA-256 of the bundled VRM files:

| File | SHA-256 |
| --- | --- |
| vroid-a.vrm | b86b0b8a66d48911431d6f920a5211a974226f83aa672eca3f3dfade58ac346e |
| vroid-b.vrm | 4a271bd3b5a3d19e054fd113ee154635b72e7141f4a8ccbcdba3c7f9cea6ee8d |
| vroid-c.vrm | 395d5b04696e888f07bc856ae01bf72a974b7e773132c7443dc59d1688045b8a |