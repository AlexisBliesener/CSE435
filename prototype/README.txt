Lane Management System prototype v2.3
=====================================

How to run
- Open index.html in a current desktop browser (Chrome, Edge, Firefox or Safari). No install, build or server is needed.
- The 3D view needs WebGL. three.js r128 loads from cdnjs; without internet the copy in vendor/ is used.

Who drives
- Every scenario starts with the automatic driver, which follows the script.
- Choose Self drive (Scenarios tab, the Take control button on the 3D view, or the T key) to drive yourself.
  Road, weather, traffic and fault events still happen on schedule; the scripted driver actions become prompts.
- In self drive the car follows the curve of the road and straightens out when you let go; keeping it in the lane is up to you or LMS.

Override and automatic re-enable
- Steering torque of 3 Nm or more (steering input past 60%) overrides LMS.
- When the driver stops steering hard, LMS turns back on after the re-enable delay (Driver tab slider, 1 to 10 s, default 3 s)
  in whichever lane the car is in. If the car is off center or straddling a line, LKS steers it to the lane center.

Languages
- HTML for structure, CSS for styling, JavaScript for all logic, three.js (WebGL) for the 3D view.

Files
- index.html        page layout, dashboard and first person cockpit
- css/styles.css    styles
- js/config.js      thresholds and requirement list (SRS section 3)
- js/road.js        road centerline and curvature
- js/traffic.js     other vehicles
- js/lms.js         Supervisory Control System, LDWS, LKS, LCS, override and timed re-enable
- js/sim.js         vehicle dynamics, automatic driver and self drive, environment, log
- js/scenarios.js   scenarios: road events, driver actions and self drive prompts
- js/world3d.js     3D view: first person, overhead and chase cameras
- js/ui.js          controls, keyboard, dashboard, cockpit, decision log
- js/audio.js       speaker beeps

Keyboard
T take control or hand back, W/S speed, A/D steer (past 60% overrides LMS), Q/E turn signal,
Z/X lane change, L enable or disable LMS, F distracted driver, V next camera view, Space pause.
