# RoboSnap - Interactive URDF Assembly
RoboSnap is a browser-based robot assembly environment built with a vibe coding approach and driven by practical CAD-modelling and URDF systems knowledge. It’s actively in development but already stable enough for real workflows. Users can visually compose mechanisms from CAD parts, snap them together, inspect assemblies, and export ready-to-use ROS/URDF packages.

## Live website : [RoboSnap](https://devashishharsh.github.io/RoboSnap/)

## What this project does
RoboSnap provides a visual, low-friction path from CAD parts to a simulation-ready robot package:

- Intuitive visual composition — drag parts into a 3D scene, position them, and use semantic attach points to snap components together with predictable offsets. You see your assembly grow as you build, not just text on a page.
- Fast joint creation — when two parts are snapped, the system infers an appropriate connection and lets you pick joint behaviour (fixed, revolute, prismatic, continuous) using clear controls and previews — no manual matrix math required.
- Instant transform & axis preview — translation/rotation origins and joint axes are displayed and editable, so you can validate kinematic behaviour visually before exporting.
- One-click export to ROS/URDF package — the editor packages URDF files, required meshes, and helper launch/config files into a downloadable archive so you can immediately load the assembly into RViz, Gazebo, or a ROS workspace.
- Lightweight part metadata & property inspection — view bounding boxes, approximate center-of-mass information, and metadata for each part; edit descriptive fields without digging into low-level formats.
- Web-native workflow — runs in a browser with no local build step required; ideal for rapid iteration, sharing prototypes, and teaching concepts.

## What is URDF?
URDF (Unified Robot Description Format) is an XML-based format widely used in the ROS (Robot Operating System) ecosystem to describe a robot’s physical structure: links (rigid bodies), joints (how bodies are connected and allowed to move), visual geometry for rendering, and inertial parameters used for simulation. A correct URDF lets simulation tools and controllers understand the robot’s kinematics, dynamics, and appearance so you can visualize, test, and run algorithms against a virtual model.

## Comparison with existing Softwares ( Fusion 360 )
--- Yet to be uploaded ---

## Known limitations
1. Approximate inertial values: current inertial entries are conservative placeholders; for high-fidelity dynamics you should replace these with CAD-derived inertia.

2. Mesh dependencies: export requires referenced meshes to be available; missing files will prevent a complete package.

3. Edge cases in nested transforms: complex multi-rooted assemblies can expose orientation quirks that we continue to harden against.

## License
This project is released under the MIT License.

## Notes
- Built with a "vibe coding" style (fast iteration, pragmatic UI-first development), informed by CAD modelling and URDF systems knowledge.

- The site/editor works locally as a static web app; export produces ROS-compatible package scaffolding for quick simulation/visualization.
