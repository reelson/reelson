// @ts-check
import { defineConfig } from 'astro/config'
import starlight from '@astrojs/starlight'

// Served by GitHub Pages at https://reelson.github.io/reelson/ (see .github/workflows/docs.yml).
// With a custom domain: set `site` to it, drop `base`, and add public/CNAME.
export default defineConfig({
    site: 'https://reelson.github.io',
    base: '/reelson',
    integrations: [
        starlight({
            title: 'reelson',
            description:
                'Turn a prompt into a finished, branded demo video of your web app. Agent Skills + a CLI for Claude Code, Codex and any agent that reads SKILL.md.',
            // the wordmark with the dot in its "o" (the dot from the launch video). Outlined Inter (wght 860), so it needs no font.
            logo: { dark: './src/assets/logo-dark.svg', light: './src/assets/logo-light.svg', replacesTitle: true },
            favicon: '/favicon.svg',
            social: [
                { icon: 'github', label: 'GitHub', href: 'https://github.com/reelson/reelson' },
                { icon: 'youtube', label: 'Launch video', href: 'https://youtu.be/AkEeA9QAUy4' },
            ],
            editLink: { baseUrl: 'https://github.com/reelson/reelson/edit/main/site/' },
            lastUpdated: true,
            customCss: [
                '@fontsource-variable/inter',
                '@fontsource-variable/jetbrains-mono',
                './src/styles/custom.css',
            ],
            expressiveCode: {
                themes: ['github-dark-default', 'github-light-default'],
                styleOverrides: {
                    borderRadius: '0.6rem',
                    codeFontFamily: "'JetBrains Mono Variable', ui-monospace, monospace",
                    codeFontSize: '0.84rem',
                },
            },
            sidebar: [
                {
                    label: 'Start here',
                    items: [
                        { label: 'What is reelson', slug: 'start/introduction' },
                        { label: 'Install', slug: 'start/installation' },
                        { label: 'Your first video', slug: 'start/first-video' },
                    ],
                },
                {
                    label: 'Prompts',
                    badge: { text: 'copy', variant: 'tip' },
                    items: [
                        { label: 'Set up a project', slug: 'prompts/setup' },
                        { label: 'Make a video', slug: 'prompts/videos' },
                        { label: 'Change & maintain', slug: 'prompts/maintain' },
                    ],
                },
                {
                    label: 'Guides',
                    items: [
                        { label: 'Writing a scenario', slug: 'guides/recording' },
                        { label: 'Callouts, zooms & trims', slug: 'guides/composing' },
                        { label: 'Templates & sections', slug: 'guides/templates' },
                        { label: 'Portrait, square & GIF', slug: 'guides/formats' },
                        { label: 'Voice-over', slug: 'guides/voice-over' },
                        { label: 'Publish to YouTube', slug: 'guides/publishing' },
                        { label: 'Keep videos current', slug: 'guides/verify' },
                    ],
                },
                {
                    label: 'Reference',
                    items: [
                        { label: 'CLI', slug: 'reference/cli' },
                        { label: 'reelson.config.json', slug: 'reference/config' },
                        { label: 'video.json', slug: 'reference/video-json' },
                        { label: 'Scenario API', slug: 'reference/scenario-api' },
                        { label: 'Style guide', slug: 'reference/style-guide' },
                        { label: 'Troubleshooting', slug: 'reference/troubleshooting' },
                    ],
                },
            ],
        }),
    ],
})
