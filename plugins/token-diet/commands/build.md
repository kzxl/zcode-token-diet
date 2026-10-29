---
description: Build the .NET solution and return only errors plus grouped warnings.
argument-hint: "[solution or project path]"
---
Use the `token-diet` build tool to compile this workspace.

Project argument (may be empty for auto-detection): $ARGUMENTS

Report the build status, the error list, and the warning codes. If an error needs more surrounding log, read `.token-diet/build.log` with an offset instead of re-running the build. Do not run `dotnet build` directly.
