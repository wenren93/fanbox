# Skills 透视：Skill 发现与安全安装规格

## Problem Statement

FanBox 用户已经可以在 Skills 透视中查看、启停、卸载和跨 Agent 导入本机 Skill 安装项，但无法在同一处发现新的外部 Skill。用户目前必须离开 FanBox，自行寻找来源、判断目录结构、下载文件、选择目标 Agent 并处理冲突；这个过程既繁琐，也容易把名称相同但来源不同的 Skill 当成更新，或在未固定版本、未检查文件结构的情况下把不确定内容写入 Agent 的 Skill 目录。

用户需要一个内容丰富、实现简单且安全边界清楚的“发现”能力：能够搜索 skills.sh 的社区索引，一键发起检查与安装，同时始终区分尚未安装的 Skill 条目和本机 Skill 安装项。FanBox 应固定公开 GitHub 来源的具体版本，只对可客观验证的文件与结构风险作判断，不执行外部内容、不声称 Skill 安全，并在失败、冲突或并发变化时保持本机安装项可恢复。

## Solution

Skills 透视顶部增加“已安装 / 发现”两个一级页签。“已安装”保留现有本机管理能力；“发现”从本机直接调用 skills.sh 匿名搜索接口，按用户显式提交的关键词展示最多 20 个 Skill 条目。搜索结果只展示搜索接口能够可靠提供的名称、来源和安装量，并明确标记“尚未检查”。

用户点击“检查并安装”后，FanBox 只接受能够解析为公开 GitHub 仓库的条目。FanBox 使用本机 Git 取得仓库 HEAD 的完整 commit SHA，从 GitHub codeload 下载该 commit 的固定归档，在随机临时目录中使用 macOS 系统 tar 进行受限解包，并从归档中唯一匹配符合 Agent Skills 命名约束的 Skill 子目录。随后 FanBox 从固定版本本地解析描述、许可证、文件清单、权限、脚本、二进制资源、工具声明和外部依赖，形成安装确认页。

普通检查通过时，用户确认目标 Agent 后即可安装；存在脚本、高权限工具或未知许可证等未知风险时，用户必须展开风险明细并勾选确认。FanBox 不接入第三方审计、不执行脚本、不安装依赖、不调用 Agent 分析远端内容。真正落盘复用现有 Skills 写操作的串行、临时副本、原子换位、废纸篓和回滚边界；成功后记录来源身份与固定版本，刷新“已安装”页并展开新安装项。

## User Stories

1. As a FanBox user, I want to open a Discover tab inside Skills perspective, so that I can find new Skills without leaving FanBox.
2. As a FanBox user, I want Installed and Discover to be separate top-level tabs, so that I never confuse an external Skill entry with a local Skill installation.
3. As a user managing local Skills, I want the Installed tab to retain its current filters, sorting, search, expansion, batch operations and statistics, so that discovery does not regress existing workflows.
4. As a user returning from Discover, I want my Installed filters to remain unchanged, so that I can continue where I left off.
5. As a user returning to Discover, I want my latest query and results to remain during the FanBox session, so that tab switching does not lose my place.
6. As a privacy-conscious user, I want a persistent notice that my search term will be sent directly from my computer to skills.sh, so that the network boundary is explicit.
7. As a privacy-conscious user, I want search to run only after I press Enter or click Search, so that partial input is not transmitted.
8. As a privacy-conscious user, I do not want my local Skill list, project path, target Agent or installation history sent with a search, so that discovery exposes only the query required by skills.sh.
9. As a user, I want search results to follow skills.sh relevance order, so that FanBox does not invent a lower-quality ranking.
10. As a user, I want at most 20 results per search, so that the first release stays quick and understandable.
11. As a user, I want to search using Chinese input without composition glitches, so that normal text entry works correctly.
12. As a user, I want an explicit empty-result state, so that I can distinguish no matches from a broken request.
13. As a user, I want timeout, rate-limit and response-format failures explained as external search failures, so that they are not misreported as no results.
14. As a user, I want a recent cached result displayed with its age when skills.sh is unavailable, so that I can still inspect what I previously found.
15. As a user, I want cached results to disable installation when their source cannot be revalidated online, so that stale display data is not treated as installable content.
16. As a user, I want only the most recent successful query and up to 20 results stored for 24 hours, so that offline help does not become a search-history database.
17. As a user repeating the same query within 10 minutes, I want FanBox to reuse the result, so that unnecessary network requests are avoided.
18. As a user, I want each search result to show its name, source repository and skills.sh installation count, so that I can compare basic popularity and provenance.
19. As a user, I want every untouched search result marked as not yet checked, so that popularity is not presented as a safety assessment.
20. As a user, I want a single “Check and install” action, so that one click begins the complete validation flow.
21. As a user, I want to open the original source page from a result, so that I can investigate content FanBox does not summarize.
22. As a security-conscious user, I want installation limited to public GitHub repositories, so that the first release does not handle credentials or arbitrary download hosts.
23. As a user encountering a non-GitHub entry, I want to view its source while installation is disabled with an explanation, so that unsupported does not mean invisible.
24. As a user encountering a private repository, I want FanBox to explain that authentication is unsupported, so that it does not silently prompt for or retain a GitHub token.
25. As a user whose Mac has no usable Git command, I want discovery to remain available while installation explains the missing prerequisite, so that one missing tool does not break the whole Skills perspective.
26. As a user whose Mac has no usable system tar, I want discovery to remain available while installation explains the missing prerequisite, so that the limitation is localized.
27. As a user, I want FanBox to resolve the repository HEAD to a full 40-character commit SHA before downloading, so that the installed version cannot move during installation.
28. As a user, I want the downloaded archive tied to the resolved commit SHA, so that the same source version is reproducible.
29. As a security-conscious user, I do not want FanBox to trust the skills.sh download snapshot as the installed content, so that a snapshot not bound to a commit cannot bypass version pinning.
30. As a user, I want FanBox to identify exactly one Skill subdirectory in the fixed archive, so that it never guesses between multiple SKILL.md files.
31. As a user encountering no matching Skill directory, I want installation blocked with a source link, so that I can inspect or report the upstream problem.
32. As a user encountering multiple matching Skill directories, I want installation blocked instead of choosing one heuristically, so that the result is deterministic.
33. As a user, I want the fixed Skill frontmatter name to follow the Agent Skills naming rule, so that the target directory is valid and predictable.
34. As a user, I want the frontmatter name and matched directory name to agree, so that FanBox does not silently rename or repair external content.
35. As a user encountering an invalid name, I want installation blocked and the upstream source available, so that FanBox does not create an ambiguous local installation.
36. As a security-conscious user, I want archive downloads stopped after 10 MiB, so that an unexpectedly large source cannot consume unlimited bandwidth or disk.
37. As a security-conscious user, I want extracted content stopped after 25 MiB, so that compressed expansion is bounded.
38. As a security-conscious user, I want extraction stopped after 1,000 files, so that file-count abuse is bounded.
39. As a security-conscious user, I want any individual file above 10 MiB to block installation, so that one file cannot evade useful limits.
40. As a security-conscious user, I want extraction performed in a new random temporary directory, so that external content cannot overwrite existing files during inspection.
41. As a security-conscious user, I want absolute paths and parent traversal rejected, so that archive entries cannot escape the temporary directory.
42. As a security-conscious user, I want symbolic links and hard links rejected, so that archive references cannot escape or behave differently across machines.
43. As a security-conscious user, I want device files, FIFOs, sockets and other special files rejected, so that only normal Skill content can be installed.
44. As a security-conscious user, I want SUID, SGID, sticky bits, ACLs, extended attributes and file flags removed, so that external archives cannot transfer elevated filesystem behavior.
45. As a Skill author, I want ordinary images, fonts, PDFs and other non-executable binary resources preserved, so that content-rich Skills still work.
46. As a security-conscious user, I want unknown executable binaries blocked, so that FanBox does not install opaque programs under the guise of resources.
47. As a Skill author, I want executable script intent preserved in a normalized form, so that scripts that users approve remain callable.
48. As a security-conscious user, I want executable files normalized to 0755, non-executable files to 0644 and directories to 0755, so that only necessary execution semantics survive.
49. As a security-conscious user, I want scripts listed before installation, so that executable behavior is visible.
50. As a security-conscious user, I want declared high-permission tools and external dependencies listed before installation, so that capability and setup implications are visible.
51. As a security-conscious user, I do not want FanBox to execute installation scripts or commands, so that checking content cannot trigger it.
52. As a security-conscious user, I do not want FanBox to install dependencies automatically, so that external content cannot mutate my system beyond the chosen Skill directory.
53. As a security-conscious user, I do not want FanBox to ask an Agent to analyze remote Skill instructions, so that untrusted natural-language content is never executed as a prompt during installation.
54. As a user, I want remote strings rendered as escaped plain text, so that Markdown or HTML content cannot inject UI behavior.
55. As a user, I want the installation confirmation to show name, description, source, author, fixed commit, target Agent and local check result, so that I know exactly what is being installed.
56. As a user, I want the confirmation to summarize file count, total size, scripts, binary resources, tool declarations and external dependencies, so that the important risk surface is scannable.
57. As an advanced user, I want to inspect the complete file list, so that I can investigate beyond the summary.
58. As a user, I want license information read first from Skill frontmatter or the Skill directory, so that the displayed license is scoped as closely as possible.
59. As a user, I want a repository license used only when its scope clearly covers the Skill, so that FanBox does not overstate usage rights.
60. As a user encountering no clear license, I want to see “License unknown,” so that absence is not presented as permission.
61. As a user installing a Skill with an unknown license, scripts or high-permission tools, I want risk details expanded and an acknowledgement checkbox required, so that enhanced confirmation reflects the uncertainty.
62. As a user installing a straightforward Skill with no enhanced-confirmation signals, I want one normal confirmation click, so that one-click installation remains practical.
63. As a user, I do not want to type the Skill name as confirmation, so that warnings remain meaningful without becoming ritual friction.
64. As a user, I do not want third-party audit badges or verdicts in the first release, so that reports not bound to the installed commit do not create false confidence.
65. As a user, I want to choose Claude, Codex, Agents or WorkBuddy as the target Agent, so that the discovered Skill reaches the tool I use.
66. As a user, I want to remember one application-wide default target Agent, so that later installations need less repetition.
67. As a user, I want the confirmation page to always allow changing the remembered target, so that the default never becomes a hidden decision.
68. As a user, I want FanBox to create a missing controlled target directory only after installation confirmation, so that the choice is explicit.
69. As a security-conscious user, I do not want the client to submit an arbitrary target filesystem path, so that installation cannot become a general write API.
70. As a user, I want the installed directory named from the validated Skill name, so that local identity remains predictable.
71. As a user, I want FanBox to store the repository, Skill path, commit SHA and content hash after a successful installation, so that the installation has a durable source identity and fixed version.
72. As a Skill author, I do not want FanBox metadata written into my Skill directory, so that installed content stays faithful to the fixed source.
73. As a user, I want source metadata stored only after files are installed successfully, so that failed operations do not create phantom installations.
74. As a user, I want source metadata and files switched or rolled back together during an update, so that they cannot disagree.
75. As a user, I want uninstall to remove the associated source record, so that stale update identity is not retained.
76. As a user, I want losing a source record to leave the Skill usable, so that FanBox metadata is not a runtime dependency.
77. As a user, I want two entries with the same name but different source identities treated as different Skills, so that an unrelated author cannot overwrite an installation by name.
78. As a user encountering a same-name different-source installation, I want the new installation blocked and the existing item located, so that I can make an informed manual choice.
79. As a user, I want the same repository and Skill path recognized as the same source across commits, so that a newer fixed version can be offered as an update.
80. As a user, I do not want background update checks or automatic updates in the first release, so that external traffic and state management remain predictable.
81. As a user encountering the same source again in Discover, I want the action labelled as reinstall or update, so that its relationship to my installation is clear.
82. As a user updating a Skill, I want the new version to repeat all download, structure and risk checks, so that an earlier approval does not bless future content.
83. As a user who edited an installed Skill locally, I want FanBox to detect the content-hash mismatch, so that an update does not silently erase my changes.
84. As a user updating a locally modified installation, I want explicit overwrite confirmation and the old content moved to Trash, so that my changes remain recoverable.
85. As a user with an older installation that lacks a source record, I want FanBox to treat it as an unknown conflict, so that it does not infer identity from name alone.
86. As a user resolving an unknown same-directory conflict, I want explicit confirmation before replacement and the old installation moved to Trash, so that migration is deliberate and reversible.
87. As a user, I want download, extraction and inspection to occur before the Skills write queue is entered, so that long network work does not block unrelated local management operations.
88. As a user, I want final installation and update writes serialized with existing Skills mutations, so that multiple windows cannot race local state.
89. As a user, I want a temporary sibling installation constructed and checked before becoming visible, so that scanners never observe half an installation.
90. As a user, I want concurrent source, target or content changes detected before the atomic switch, so that stale confirmation cannot overwrite newer work.
91. As a user, I want replacement content and the previous installation atomically switched, so that I see either the old or new complete state.
92. As a user, I want the previous installation moved to system Trash during replacement, so that it can be recovered.
93. As a user, I want failed replacement to restore the previous installation and source metadata, so that failure does not damage working content.
94. As a user, I want all temporary download and extraction data cleaned after success or failure, so that inspection does not leave residue.
95. As a user, I want a failed installation confirmation page to retain its context and explain the failure, so that I can retry without starting the search again.
96. As a user, I want installation failures to leave no visible Skill installation, so that the Installed tab remains trustworthy.
97. As a user, I want a successful installation placed in the target Agent's normal enabled Skill directory, so that new Agent sessions can discover it.
98. As a user, I do not want FanBox to restart a running Agent automatically, so that installation does not interrupt my work.
99. As a user, I want the success message to explain that a new session can discover the Skill and that Codex may require restart, so that activation expectations are clear.
100. As a user, I want FanBox to switch to Installed after success and expand the new item, so that I can immediately verify where it landed.
101. As a user, I want existing Installed filters preserved after success, so that installation does not disrupt how I was viewing local items.
102. As a user on a non-macOS platform, I want Discover and source links to remain available while installation is clearly marked macOS-only, so that the limitation is explicit and localized.
103. As a user, I want discovery failure to never break Installed, so that an external service cannot take down local Skill management.
104. As a maintainer, I want skills.sh access behind one replaceable provider boundary, so that an undocumented endpoint change is localized.
105. As a maintainer, I want no new product telemetry for discovery, so that the feature does not create a new tracking system.
106. As a privacy-conscious user, I want the documentation to state that FanBox accesses skills.sh, GitHub Git service and GitHub codeload and what each receives, so that outbound behavior is transparent.
107. As a maintainer, I want existing import, enable, disable, uninstall and batch-management behavior to keep working, so that discovery does not regress the current Skills perspective.
108. As a maintainer, I want the selected prototype decision recorded as a top-level Installed/Discover tab structure, so that implementation does not reopen the resolved information architecture question.

## Implementation Decisions

- Use the project vocabulary consistently: an external searchable record is a **Skill entry**; **Discovery** searches and browses entries; **Installation** creates a local **Skill installation**; existing local cross-Agent copying remains **Import**.
- Use the prototype-selected top-level tab structure: Installed and Discover are sibling tabs inside Skills perspective. They keep separate result models, search states and actions; external entries never join the local installation list.
- Preserve the current Installed rendering and behavior. Discovery is an additional state inside the existing Skills perspective, not a new application-level navigation destination.
- Add a dedicated Skill discovery provider boundary on the local FanBox service. The first provider directly calls the anonymous skills.sh `/api/search` endpoint from the user's machine with a bounded query and result limit. The UI does not call arbitrary registry URLs.
- Do not invoke or parse the `skills` CLI. The anonymous JSON endpoint is consumed directly and its response is validated against a narrow schema. Unknown fields are ignored; missing or malformed required fields fail the external search rather than becoming empty results.
- Search is explicit, not live. Enter and the Search button submit a trimmed query. Search returns at most 20 results and preserves upstream order. No pagination, infinite scrolling, filters, featured page or alternative sort is included.
- Keep the latest successful query and at most 20 normalized results for 24 hours. Reuse an identical query for 10 minutes. Cached results are display-only when online revalidation is unavailable.
- Search-result fields are limited to data the anonymous endpoint actually provides: stable entry identifier where available, Skill name/ID, repository source and installation count. Description, license and safety are not inferred before inspection.
- The Check and Install action is a two-stage workflow: first resolve and inspect a fixed source in a random temporary area, then present a confirmation and perform the final controlled local write.
- Only public GitHub repository entries are installable in the first release. Private GitHub sources, non-GitHub sources, arbitrary URLs, archives supplied by users and authenticated GitHub access are unsupported. Unsupported entries remain viewable through their source link.
- Resolve the repository's current HEAD with the local Git executable and accept only a complete 40-character commit SHA. The installation pipeline never treats a mutable branch name as the installed version.
- Download the repository archive only from GitHub codeload using the resolved commit SHA. Do not install from the skills.sh snapshot endpoint because it is not bound to a commit and cannot faithfully express all file types or modes.
- The first release enables installation only on macOS. Use fixed system tools (`git` from the environment and `/usr/bin/tar`) without adding an archive library. Missing prerequisites disable installation but do not disable discovery.
- Download to a new random system temporary directory. Limit the compressed stream to 10 MiB. Use system tar without absolute-path, unlink-first or permission-preservation modes; do not restore owners, ACLs, extended attributes or system flags.
- Monitor extraction and terminate it when expanded content exceeds 25 MiB or 1,000 files. Reject any single file above 10 MiB. Fully traverse the final tree with `lstat` before inspection or copying.
- Reject absolute paths, parent traversal, symbolic links, hard links, devices, FIFOs, sockets, other special entries, special permission bits and unknown executable binaries. Ordinary non-executable binary resources are allowed.
- Normalize installed directories to 0755, normal files to 0644, and files carrying any source execute bit to 0755. List executable files in enhanced confirmation. Never retain SUID, SGID, sticky, ACL, xattr, owner or file-flag metadata.
- Scan the fixed archive for valid `SKILL.md` candidates and uniquely match the skills.sh Skill ID/name. Do not guess among candidates. Require the selected frontmatter name to be 1–64 lowercase letters, digits and single hyphens and to match its directory name; do not silently rename or repair it.
- Derive the target directory from the validated frontmatter name. The installation API accepts only a controlled target Agent identifier for Claude, Codex, Agents or WorkBuddy; the server resolves the root and never accepts an arbitrary target path.
- Parse name, description, optional license, compatibility, allowed tools and metadata from the fixed local content. Inspect the complete file tree, sizes, file kinds, execute modes, likely scripts, binary resources and declared external dependencies. Treat all external text as escaped plain text.
- License resolution prefers frontmatter and a license clearly scoped to the Skill directory. Use a repository-level license only when its scope clearly covers the Skill. Otherwise show License unknown and require enhanced confirmation. FanBox does not mirror or redistribute installed content.
- Do not call third-party audit APIs, display audit badges or derive a composite safety verdict. Do not call an Agent to judge `SKILL.md`. Risk Check covers only deterministic local facts and must never be labelled certification or safety guarantee.
- Never render external Markdown as active HTML during inspection. Never execute scripts, installers, hooks or dependencies from an external Skill.
- Normal confirmation shows name, description, source identity, repository author, fixed commit short hash, target Agent, Risk Check result, file count, expanded size and counts for scripts, binary resources, tools and dependencies. It offers complete file-list and source-page views.
- Enhanced confirmation applies when the Skill contains scripts, declares high-permission tools, has an unknown license or carries another locally detectable unknown-risk signal. It expands details and requires an acknowledgement checkbox; it does not require typing the Skill name.
- Remember an optional application-wide default target Agent in local settings. Confirmation always exposes target selection and may create a missing controlled target directory only after confirmation.
- Model source identity as the canonical public repository plus the Skill subdirectory. Store the fixed commit SHA and deterministic content hash for the installed version. Skill name alone never establishes identity.
- Store source records in FanBox-owned local state, not inside Skill content. The record is written only with a successful installation and is atomically switched or rolled back with the installation. Uninstall removes it; losing it does not affect Agent discovery or execution.
- The same source identity at a different commit is a same-source reinstall/update. A same name with a different source identity is blocked and points to the existing installation. An existing target without a source record is an unknown conflict requiring explicit replacement confirmation.
- Detect local edits by comparing the installed tree with its recorded content hash. A locally modified installation cannot be silently updated; replacement requires explicit confirmation and preserves the old content in system Trash.
- Do not perform background update checks or automatic updates. Encountering the same source in Discover may offer Reinstall/Update, but every attempt repeats resolution, download, inspection and confirmation.
- Perform network download, extraction and local inspection outside the Skills write queue. Enter the existing serialized write boundary only for the final preflight and filesystem mutation.
- Reuse the current safe local mutation pattern: rescan and revalidate target identity, construct a complete temporary sibling installation, recheck source/target fingerprints, atomically switch, move replaced content to system Trash, write the matching source record, and roll both files and metadata back on failure.
- Clean all temporary download, extraction and staging content after success or failure. A failed operation retains the confirmation context and structured error for retry but leaves no visible partial installation.
- Install into the normal enabled root without calling existing enable/disable APIs. Do not restart Agents. On success, switch to Installed, preserve its filters, refresh data and expand the new installation; explain new-session and Codex-restart expectations.
- Add no product telemetry. Update privacy documentation to identify skills.sh search, Git remote resolution and GitHub codeload archive download, including which data each receives. Do not persist a search-history log.
- Keep source discovery failure isolated from Installed. Provider timeout, rate-limit, schema change, offline state or cache expiry must not degrade local scanning and management.

## Testing Decisions

- Prefer the highest existing backend seam: start a real FanBox service with an isolated HOME and isolated Claude, Codex, Agents and WorkBuddy roots; send HTTP requests through the public local API; assert normalized responses, filesystem results, source records, Trash/recovery effects and refreshed scan results. This extends the established Skills import and batch-management integration-test pattern instead of introducing unit tests coupled to internal helpers.
- Test discovery through a controllable fake upstream at the network boundary. Verify explicit query submission, query/limit encoding, normalized upstream order, 20-result cap, response-schema rejection, timeout, rate limit, empty result, identical-query reuse, 24-hour cache display and offline installation disablement.
- Test installation as an externally observable workflow using fixed fixture repositories/archives and fake GitHub endpoints or injected fixed tool/network boundaries. The test should submit a discovered entry, receive an inspection/confirmation model, confirm a controlled target and observe the final installation and scan result.
- Cover successful public-GitHub installation to all four controlled targets, including nested text, ordinary binary resources, empty directories and executable scripts with normalized modes.
- Cover fixed-version behavior: accept only a 40-character commit SHA, request codeload by that SHA, record the repository/path/SHA/hash identity, and reject a source that changes between inspection and final write.
- Cover archive safety as public behavior: compressed limit, expanded limit, file-count limit, per-file limit, absolute/parent path, symlink, hardlink, device, FIFO, socket, special bits, unknown executable binary and unsafe or malformed tar output all produce a structured blocked result with no target side effects.
- Cover Skill matching and validity: no candidate, multiple candidates, invalid or mismatched frontmatter name, unreadable/missing SKILL.md and unsupported source all remain non-installable with an explanatory reason and source link.
- Cover confirmation classification: ordinary resources permit normal confirmation; scripts, high-permission tools and unknown licenses require an acknowledgement; complete file list and fixed source data are present; third-party audit data is absent.
- Cover target and conflict behavior: arbitrary target identifiers/paths are rejected; missing controlled roots can be created after confirmation; same-name different-source is blocked; same-source newer commit becomes update; unknown-source same-directory requires explicit replacement; local content modification is detected.
- Cover atomicity and recovery: queued concurrent final writes serialize, target/source fingerprints are rechecked, previous content moves to Trash on replacement, source record switches with files, induced failures restore both, and temporary content is cleaned.
- Cover post-install behavior: Skills data refreshes, the new installation is in the normal enabled root, existing enabled/disabled configuration remains respected, no restart is triggered, and the result reports restart/new-session guidance.
- Preserve existing behavior by running the current Skills import, toggle, uninstall, batch and UI suites unchanged.
- For frontend behavior, follow the existing Skills perspective source-contract testing precedent for stable wiring: top-level Installed/Discover tabs, explicit Enter/button search, separate search state, privacy notice, cached/failed states, Check and Install flow, target/default selection, enhanced confirmation, success navigation and retained Installed filters.
- Add one real-browser acceptance path for the critical interaction: open Skills perspective, switch to Discover, submit a query, start Check and Install, inspect a fixed source, confirm a target, complete installation, return to Installed and see the new item expanded. Browser acceptance supplements rather than replaces the service-level integration seam.
- Good tests assert user-visible or filesystem-observable behavior and structured API outcomes. They should not assert private helper names, exact command construction beyond security-relevant arguments, exact HTML fragments, temporary directory names or implementation-specific call counts.

## Out of Scope

- Ordinary GitHub code or repository search as a fallback data source.
- Featured, curated, trending or weekly discovery pages.
- Pagination, infinite scroll, client-side result sorting or discovery filters.
- FanBox-hosted search proxy, account system, cloud cache or server-side search history.
- Authenticated skills.sh v1 APIs, Vercel OIDC and embedded service credentials.
- Third-party security audits, audit badges, trust scores or claims that a Skill is safe or certified.
- Private GitHub repositories, GitHub login, personal access tokens and enterprise GitHub hosts.
- Non-GitHub Skill sources, arbitrary Git URLs, arbitrary archive URLs, local archive selection and URL installation.
- Installation on Windows or Linux in the first release.
- Custom target directories or additional unsupported Agent roots.
- Installing into project-level Skill roots.
- Automatic dependency installation, install scripts, lifecycle hooks or running any external executable during inspection.
- Agent/LLM-based analysis of external Skill instructions.
- Automatic repair, renaming, metadata rewriting or normalization of invalid upstream Skills beyond safe filesystem modes.
- Background update checks, notifications, scheduled updates and automatic updates.
- FanBox mirroring or redistribution of upstream Skill content.
- Allowing users to bypass hard structural, path, archive or executable-binary blocks.
- Replacing the current local cross-Agent Import semantics; external Installation remains a separate capability.

## Further Notes

- The UI decision was validated with a throwaway prototype. Variant A won: top-level Installed and Discover tabs. The prototype is design evidence and should live on a throwaway branch rather than ship with production code.
- The skills.sh anonymous search endpoint is used by the official skills CLI but is not part of the documented authenticated v1 API. The provider boundary and strict schema handling are deliberate so an upstream change only disables Discovery and can be adapted locally.
- The architecture follows the existing ADRs: local Import remains an independent copy; external Installation is identified by repository plus Skill path and records a fixed commit/content hash; external content comes from a commit-pinned GitHub archive rather than an unpinned skills.sh snapshot.
- Current macOS BSD tar refuses parent traversal and unsafe symlink target paths by default when insecure flags are not used, but FanBox still performs explicit pre/post checks and bounded monitoring because tool defaults are not a complete product security boundary.
- README and privacy documentation currently describe a smaller set of outbound requests; implementation must update them before release.
