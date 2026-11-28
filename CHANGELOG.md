# Changelog

## [0.3.0](https://github.com/hugoh/obsidian-search-open/compare/0.2.0...0.3.0) (2026-11-28)


### Features

* read-only preview with lasting match marks, working Ctrl+N/P, and a leaner derivative of Floating Search ([#19](https://github.com/hugoh/obsidian-search-open/issues/19)) ([97579b9](https://github.com/hugoh/obsidian-search-open/commit/97579b9e6e474afc2d0d3dd9446a686c0ba58bb1))


### Bug Fixes

* keep a link followed in the preview from being replaced by the scheduled preview ([#21](https://github.com/hugoh/obsidian-search-open/issues/21)) ([ef20f98](https://github.com/hugoh/obsidian-search-open/commit/ef20f98e5cc79f019c78eadd1726406932e0e360))

## [0.2.0](https://github.com/hugoh/obsidian-search-open/compare/0.1.3...0.2.0) (2026-11-25)


### Features

* narrow to the global search modal and rename to Search & Open ([#16](https://github.com/hugoh/obsidian-search-open/issues/16)) ([83c6215](https://github.com/hugoh/obsidian-search-open/commit/83c6215569868655d3ff2dbfe9d1a9ceb990f557))


### Bug Fixes

* close the code-review findings and clean up the leftovers ([#18](https://github.com/hugoh/obsidian-search-open/issues/18)) ([f2e393d](https://github.com/hugoh/obsidian-search-open/commit/f2e393d5a39862cc9cc64ed30861a460b8dbcd60))

## [0.1.3](https://github.com/hugoh/obsidian-floating-search-next/compare/0.1.2...0.1.3) (2026-11-19)


### Bug Fixes

* initialise state at load and merge window-open handlers ([#11](https://github.com/hugoh/obsidian-floating-search-next/issues/11)) ([fac5817](https://github.com/hugoh/obsidian-floating-search-next/commit/fac58172164e69fc731bb89ee5594b255414ed5f))

## [0.1.2](https://github.com/hugoh/obsidian-floating-search-next/compare/0.1.1...0.1.2) (2026-11-19)


### Bug Fixes

* address community scorecard findings and lint the gaps ([#9](https://github.com/hugoh/obsidian-floating-search-next/issues/9)) ([cb119a0](https://github.com/hugoh/obsidian-floating-search-next/commit/cb119a0cdd65fa1b398dd1d79ba380af712babb7))

## [0.1.1](https://github.com/hugoh/obsidian-floating-search-next/compare/0.1.0...0.1.1) (2026-11-19)


### Bug Fixes

* **deps:** update monkey-around to v3, builtin-modules to v5, eslint-plugin-obsidianmd to v0.6 ([#4](https://github.com/hugoh/obsidian-floating-search-next/issues/4)) ([f947f16](https://github.com/hugoh/obsidian-floating-search-next/commit/f947f164e2e107fe36ed8db43ae8c683b9478efa))
* **release:** drop release-as so releases bump past 0.1.0 ([#7](https://github.com/hugoh/obsidian-floating-search-next/issues/7)) ([dea2ec2](https://github.com/hugoh/obsidian-floating-search-next/commit/dea2ec295f0de82045c9f02bc069df3c8ea8c648))
* **test:** stabilise e2e specs that race the vault index and result re-renders ([b1ab99f](https://github.com/hugoh/obsidian-floating-search-next/commit/b1ab99fc41588259d994cb581f95f3c5fe7c4c13))

## 0.1.0 (2026-11-19)


### Features

* add CMDK quick search modal with progressive rendering ([3896bcf](https://github.com/hugoh/obsidian-floating-search-next/commit/3896bcfc34e1be842783e977e74818149953eec8))
* add zh-CN / en UI strings for settings, commands, and modal hints ([7e10b1e](https://github.com/hugoh/obsidian-floating-search-next/commit/7e10b1e4847f1e5097790a7fd2bbbc747b973cea))
* **cmdk:** add content search and preview scroll-to-position ([e3201d9](https://github.com/hugoh/obsidian-floating-search-next/commit/e3201d9ed632278abde581402422a05e9bf7d477))
* **i18n:** resolve locales properly, localise Untitled, document adding a language ([4838ac6](https://github.com/hugoh/obsidian-floating-search-next/commit/4838ac6290ccb06dc1143b7459820c3d1f10d4c0))
* optional auto-preview, clearer exclusions, regex notice; format with hk ([1c67ac5](https://github.com/hugoh/obsidian-floating-search-next/commit/1c67ac53c3995692446f99e0e762e93e4cd07c9b))
* Phosphor window-search ribbon icon and vertically centered setting cards ([ef0d974](https://github.com/hugoh/obsidian-floating-search-next/commit/ef0d974b47485552b45bf8085fbd9fc667e66998))
* rename id to float-search-window and add type/starred/regex filters ([d99db1a](https://github.com/hugoh/obsidian-floating-search-next/commit/d99db1ab9ba2e4518326985a12ab07625e13e546))
* **search:** 统一筛选引擎并修复标签匹配 ([da7ff8b](https://github.com/hugoh/obsidian-floating-search-next/commit/da7ff8bd8310616ea926bdcb1422ca7d7857e4f4))
* support all kinds of search operator ([9875f56](https://github.com/hugoh/obsidian-floating-search-next/commit/9875f56314cc61eced37e5450c7f28996027dde0))
* support click to collapse ([38bf9d8](https://github.com/hugoh/obsidian-floating-search-next/commit/38bf9d858bf6b3fb47a8cfee3c66f2a31e7671d5))
* support create a dependent window ([b0f0fe6](https://github.com/hugoh/obsidian-floating-search-next/commit/b0f0fe6adf60e8cb9681836d176487d17d341afa))
* support create a dependent window ([87fa550](https://github.com/hugoh/obsidian-floating-search-next/commit/87fa550d41bc99f4fbf9e6290cefdc389e92bef8))
* support create via ctrl+shift+enter ([2856937](https://github.com/hugoh/obsidian-floating-search-next/commit/285693757c1023d96948f67c0ca5efe185cae1e8))
* support double tab to focus on file ([9f2d6d2](https://github.com/hugoh/obsidian-floating-search-next/commit/9f2d6d28841596df4c93ea34739f510c4d8a83eb))
* support features like update window cleartimeout ([81fb30c](https://github.com/hugoh/obsidian-floating-search-next/commit/81fb30c5322d68ce078c36922458fdfde2a30f61))
* support hotkey switch and support uri ([ec1e94c](https://github.com/hugoh/obsidian-floating-search-next/commit/ec1e94c41653454de9ca5061329c9b95b8691442))
* support keyboard navigation ([d1751ee](https://github.com/hugoh/obsidian-floating-search-next/commit/d1751ee6b627e21105715c39a2e297dac4a05b8b))
* support keyboard navigation ([4a13dbc](https://github.com/hugoh/obsidian-floating-search-next/commit/4a13dbc005f30ae342d642dcd1459370a7951c6b))
* support open search view directly ([5832628](https://github.com/hugoh/obsidian-floating-search-next/commit/5832628666f038a981b5be9ae609cbf004df928d))
* support open search view in leaf ([f277a56](https://github.com/hugoh/obsidian-floating-search-next/commit/f277a56114d967978ca117bfa6715d8a60083d67))
* support open search view in leaf ([0644d31](https://github.com/hugoh/obsidian-floating-search-next/commit/0644d317c987f43a45871c8563ec26d236f607cf))
* support pass view state ([8953f21](https://github.com/hugoh/obsidian-floating-search-next/commit/8953f2175d60bca0d6c5171891bc13e70f86c2fa))
* support pass view state ([e56db18](https://github.com/hugoh/obsidian-floating-search-next/commit/e56db18faeba22ea95625fa189e58f71ac897940))
* support preview and editing in modal ([70129f7](https://github.com/hugoh/obsidian-floating-search-next/commit/70129f71d578df363a302a13b9e1e96aa877ac40))
* support record last state via hotkey ([1a24fbc](https://github.com/hugoh/obsidian-floating-search-next/commit/1a24fbc0363fe8d4ad98e8732d2c65543c74a041))
* support right click menu ([124d842](https://github.com/hugoh/obsidian-floating-search-next/commit/124d842d40c03022c7d802c2fa105a326d586bf3))
* support save current settings ([6a322e9](https://github.com/hugoh/obsidian-floating-search-next/commit/6a322e9217ed8fa71062bbbc610378d67b0ac0ae))
* support search in backlink ([2d88616](https://github.com/hugoh/obsidian-floating-search-next/commit/2d886168cddc35bb7c0d95ef7e3ed835bd6dfedb))
* support search in current file ([272c29a](https://github.com/hugoh/obsidian-floating-search-next/commit/272c29a7652f5fef9e71bcd60a26a6b9a5021d6d))
* support show file path ([e07d858](https://github.com/hugoh/obsidian-floating-search-next/commit/e07d858159b514ea4a0e194ed9303c0119cb5539))
* support show file path ([929f25c](https://github.com/hugoh/obsidian-floating-search-next/commit/929f25c0bffc2aaaf134c293fb74cdb2b82f2b83))
* support show file path ([a9913fd](https://github.com/hugoh/obsidian-floating-search-next/commit/a9913fd27824a36a1105b89d75c366e216760fd2))
* support switch view mode ([922ce5c](https://github.com/hugoh/obsidian-floating-search-next/commit/922ce5c72bd4c6048a498c464dfefcd45909d8b6))
* support toggle file path visibility ([e5480ea](https://github.com/hugoh/obsidian-floating-search-next/commit/e5480ead331ba3a95f3d4e5ce71b528c3a8c2a92))
* support toggle preview ([f4741d1](https://github.com/hugoh/obsidian-floating-search-next/commit/f4741d1edd9e38397cdcaa36bf75213855db1d86))
* support unfold/fold via keyboard ([921353e](https://github.com/hugoh/obsidian-floating-search-next/commit/921353e44620980e6483a3912a54c6c0cb6abe36))
* support unfold/fold via keyboard ([fccd2a7](https://github.com/hugoh/obsidian-floating-search-next/commit/fccd2a7a7c5af6da59176e953abe90387b4f0301))
* tabbed settings page and rename to Float Search Window ([fcfdc01](https://github.com/hugoh/obsidian-floating-search-next/commit/fcfdc01fca448cf352a6b5d116c95ff0a3caf40c))
* 支持完整查询语法及预设内联编辑 ([6b72167](https://github.com/hugoh/obsidian-floating-search-next/commit/6b7216728eca742841a4065e98b369941ff0fd43))
* 新增排除规则、预设搜索及多语言支持 ([c5091cd](https://github.com/hugoh/obsidian-floating-search-next/commit/c5091cdc67a4cd7c0427eecf3b15a0e7086a58e5))


### Bug Fixes

* block search during IME composition to prevent premature queries ([9a944ca](https://github.com/hugoh/obsidian-floating-search-next/commit/9a944ca181efca65feda8416c196ee130d76962c))
* cannot close via hotkey ([dc5d25f](https://github.com/hugoh/obsidian-floating-search-next/commit/dc5d25f2b7c9231e1812b7abd27a421f370a3cf1))
* cannot focus on search bar after init ([4467c23](https://github.com/hugoh/obsidian-floating-search-next/commit/4467c23332a82fc97a9ed201b9825a980a18b180))
* cannot open leaf outside ([54c83dd](https://github.com/hugoh/obsidian-floating-search-next/commit/54c83dd6b9cc0efd2b7966b87235a2fede62b8c6))
* cannot open leaf when last leaf is pinned ([5330b12](https://github.com/hugoh/obsidian-floating-search-next/commit/5330b125f0def03d5e75c7e37ebbe150e9ca15ac))
* cannot save settings ([1e8f1c6](https://github.com/hugoh/obsidian-floating-search-next/commit/1e8f1c672d130d5fcd67aa0736b67d11d9b2b016))
* cannot show more context ([920801b](https://github.com/hugoh/obsidian-floating-search-next/commit/920801bc2541baa65ae6e59bcf1b918508b4edf3))
* cannot use last state ([4bad19f](https://github.com/hugoh/obsidian-floating-search-next/commit/4bad19f8f168f8780c92b7c7854799ac14e9bd66))
* ctrl+click should not open new leaf in modal ([8fd5eb2](https://github.com/hugoh/obsidian-floating-search-next/commit/8fd5eb2e0cac994dfcbb1f413538757f741a60c4))
* drop the stray _autoresearch_tmp submodule link that broke CI checkout ([256cf85](https://github.com/hugoh/obsidian-floating-search-next/commit/256cf8596202b786d7e471447c147ec18ce475b1))
* exact word search inside notes; prepare the matcher once per query ([0cc979c](https://github.com/hugoh/obsidian-floating-search-next/commit/0cc979cf6d03edc1d376b5d586c7c793a93c458d))
* harden regex search and make exclusions consistent ([dcc5989](https://github.com/hugoh/obsidian-floating-search-next/commit/dcc5989294185a54cc1dcdb389b2b56c5c14ccfe))
* load window incorrectly ([9b7a38f](https://github.com/hugoh/obsidian-floating-search-next/commit/9b7a38f0f221abd1d92683dd603d260888683969))
* open canvas would not zoom to selection ([b38e946](https://github.com/hugoh/obsidian-floating-search-next/commit/b38e946e2b965e8882a0377c875df40d39a78a5b))
* private search text, safer note names, Obsidian-style block/section, filter marker ([a85bdb8](https://github.com/hugoh/obsidian-floating-search-next/commit/a85bdb8d0dc0839c081131491d1773240ee00229))
* query issue ([2ba8f05](https://github.com/hugoh/obsidian-floating-search-next/commit/2ba8f05d669d8a6a91bfbccd949017e4eb5d2e57))
* right-align setting controls to the card edge ([bcf0eee](https://github.com/hugoh/obsidian-floating-search-next/commit/bcf0eee5cc4430bd5cc9ad1ad7c3fcbc21c22558))
* search current path would not work correctly ([878fb1f](https://github.com/hugoh/obsidian-floating-search-next/commit/878fb1f2193812ce4c5e9a9fb9b5e07269635dd8))
* search current path would not work correctly ([7b8c84d](https://github.com/hugoh/obsidian-floating-search-next/commit/7b8c84dc883c085a1a76edc42dbcc47eb3f375e1))
* settings validation, stable saved-search commands and startup races ([8dd0a8d](https://github.com/hugoh/obsidian-floating-search-next/commit/8dd0a8d0c369a6baeba009e91d41ff263cc4ee3a))
* ship styles.css, flush settings on unload, drop the redundant cache ([412c4c8](https://github.com/hugoh/obsidian-floating-search-next/commit/412c4c86bd99a86adb2232a6e4c0c3e143730436))
* should not trigger by float search itself twice ([ab7c600](https://github.com/hugoh/obsidian-floating-search-next/commit/ab7c600b3c13fb633004f99b7225bed5299f3ade))
* tag matching, quick-create collisions and moment titles ([6d02b75](https://github.com/hugoh/obsidian-floating-search-next/commit/6d02b75926ecc5e66b898262c9d15abd5c3b6c6c))
* undo tab would open search view ([f1ea991](https://github.com/hugoh/obsidian-floating-search-next/commit/f1ea991fe0d21063e439c270d7d5e71d3637581e))
* 修复嵌入预览中搜索高亮导致的崩溃 ([8fcc307](https://github.com/hugoh/obsidian-floating-search-next/commit/8fcc307f3917ca98df4ac277f81c82ae8eb9c7ee))
* 强制浮动搜索打开时清空查询词 ([514d15c](https://github.com/hugoh/obsidian-floating-search-next/commit/514d15c5447db623a34195d616f7ef4130d967e3))
* 防止外部 setState 重入导致无限循环并修复多处内存泄漏 ([f423c62](https://github.com/hugoh/obsidian-floating-search-next/commit/f423c622accc3ad7928150645223c357755c9149))


### Reverts

* activeleaf issue ([7b81ef5](https://github.com/hugoh/obsidian-floating-search-next/commit/7b81ef502e2f78f402687d05f74d905421c5cc1f))
* activeleaf issue ([faf7dd0](https://github.com/hugoh/obsidian-floating-search-next/commit/faf7dd0b08b1188b7cd41a0d8db9d76442f2dc86))
* git history ([bc5674c](https://github.com/hugoh/obsidian-floating-search-next/commit/bc5674c72d066f2a30aadf70a6ad489e87986af4))
* git history ([e740987](https://github.com/hugoh/obsidian-floating-search-next/commit/e740987ed01e124800d085f892d71acfc4ca0032))
