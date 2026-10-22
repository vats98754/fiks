# `download_figma_images` returns success, but no file is actually written to the local target

<!-- upstream: https://github.com/GLips/Figma-Context-MCP/issues/364 (opened 2026-04-24T08:27:04Z); title and body verbatim, for the ISSUE-TEXT arm -->

 ## Bug description

  `download_figma_images` returns success, but no file is actually written to the local target
  directory.

  The problem reproduces consistently in my environment for both:
  - bitmap/image nodes with valid `imageRef`
  - vector/SVG-capable nodes

  The tool reports success, and in one case even returns a full output path, but the target
  directory remains empty and the file cannot be found anywhere in the project.

  ---

  ## Environment

  - OS: Windows 11 Pro 10.0.26200
  - Working directory: `C:\Users\xl\Desktop\figma`
  - Local directories are writable
  - Manual file creation in the target directory works correctly

  ---

  ## Figma file

  - `fileKey`: `3QAuo1d9LT32Cxju6o7xDt`

  ---

  ## Reproduction

  ### Case 1: bitmap node

  Input:
  - `nodeId`: `162:4324`
  - `imageRef`: `55e0390ce0dc43e63d023aacfdb023e03ee04644`
  - `fileName`: `retry-bitmap-162-4324.png`
  - `localPath`: `C:\Users\xl\Desktop\figma\public\figma-assets\retry-final`

  Tool result:
  ```text
  Success, 1 images downloaded

  Actual result:
  - C:\Users\xl\Desktop\figma\public\figma-assets\retry-final is still empty
  - Searching for retry-bitmap-162-4324.png in the project returns no results

  ---
  Case 2: vector node

  Input:
  - nodeId: 162:4334
  - fileName: retry-vector-162-4334.svg
  - localPath: C:\Users\xl\Desktop\figma\public\figma-assets\retry-final

  Tool result:
  Success, 1 images downloaded:
  C:\Users\xl\Desktop\figma\public\figma-assets\retry-final/retry-vector-162-4334.svg

  Actual result:
  - C:\Users\xl\Desktop\figma\public\figma-assets\retry-final is still empty
  - Searching for retry-vector-162-4334.svg in the project returns no results

  ---
  Expected behavior

  When download_figma_images returns success, the file should actually exist in the localPath
  directory.

  ---
  Actual behavior

  The tool reports success, but no file is written to the local filesystem.

  ---
  Additional investigation

  I verified that the following are not the cause:

  1. Target directory does not exist
    - I manually created the directory before testing
  2. No write permission
    - I can manually create files in the same directory successfully
  3. Path format issue
    - I tested both Windows-style paths and Unix-style paths
    - Same result in both cases
  4. Filename issue
    - I tested filenames with extension, without extension, and short ASCII names
    - Same result in all cases
  5. Wrong Figma node type
    - Bitmap case uses a valid image node with a valid imageRef
    - Vector case is also accepted by the tool and reports success

  ---
  Minimal conclusion

  This appears to be a bug where download_figma_images reports success but does not actually
  persist files to the caller-visible local filesystem.

  Possible causes:
  - localPath is not mapped to the real local machine filesystem
  - the MCP/server layer reports success before verifying file existence
  - the file is written inside an isolated environment instead of the user's actual filesystem
  - the returned path is only a logical/reported path, not a real written file

  ---
  Suggested areas to check

  - Whether localPath truly maps to the caller's local filesystem
  - Whether success is returned before verifying the file exists
  - Whether Windows local write behavior is broken in this tool
  - Whether returned output paths are only echoed values instead of actual persisted files
