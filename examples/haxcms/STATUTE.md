# HAXCMS example

This folder is the site template from [haxtheweb/haxcms-nodejs](https://github.com/haxtheweb/haxcms-nodejs)
(`src/boilerplate/site`, commit 250bd65, Apache-2.0), with a two-page `site.json` whose
settings include a Google Analytics ID (`G-STATUTE01`, not a real property).

As shipped, the template loads Google Analytics as soon as the page is ready, with no way
for the visitor to refuse. That is [haxtheweb/issues#2955](https://github.com/haxtheweb/issues/issues/2955).

    npm run demo:hax         Kane finds it, Claude Code fixes index.html, Kane proves Decline and Accept
    npm run demo:hax-reset   put the original index.html back

The HAX web components load from cdn.hax.cloud, so the run needs internet access.
