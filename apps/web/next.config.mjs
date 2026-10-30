import process from "node:process";

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    const rpcUrls = [
      "https://rpc.mevblocker.io",
      "https://ethereum-sepolia-rpc.publicnode.com",
      process.env.NEXT_PUBLIC_MAINNET_RPC,
      process.env.NEXT_PUBLIC_SEPOLIA_RPC,
      process.env.NEXT_PUBLIC_LOCAL_RPC_URL || "http://127.0.0.1:8545",
    ];
    const rpcOrigins = rpcUrls.filter(Boolean).map((value) => new URL(value).origin);
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "frame-src https://www.google.com https://secure.walletconnect.org",
      "img-src 'self' data: blob: https://cdn.kleros.link",
      "font-src 'self' data: https://fonts.reown.com",
      "style-src 'self' 'unsafe-inline'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      `connect-src 'self' ${[...new Set(rpcOrigins)].join(" ")} https://cdn.kleros.link https://kleros-api.netlify.app https://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.com wss://*.walletconnect.org https://*.reown.com wss://*.reown.com https://api.web3modal.org`,
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      { source: "/api/preview/image", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'" }] },
    ];
  },
  images: {
    remotePatterns: [],
  },
  webpack: (config) => {
    // Grab the existing rule that handles SVG imports
    const fileLoaderRule = config.module.rules.find((rule) => rule.test?.test?.(".svg"));

    config.module.rules.push(
      // Reapply the existing rule, but only for svg imports ending in ?url
      {
        ...fileLoaderRule,
        test: /\.svg$/i,
        resourceQuery: /url/, // *.svg?url
      },
      // Convert all other *.svg imports to React components
      {
        test: /\.svg$/i,
        issuer: fileLoaderRule.issuer,
        resourceQuery: { not: [...fileLoaderRule.resourceQuery.not, /url/] }, // exclude if *.svg?url
        use: [
          {
            loader: "@svgr/webpack",
            options: {
              // svgr's own defaults, keeping the viewBox (an undersized icon clips
              // without it); prefixIds keeps inlined icons' clipPath ids from colliding.
              svgoConfig: {
                plugins: [{ name: "preset-default", params: { overrides: { removeViewBox: false } } }, "prefixIds"],
              },
            },
          },
        ],
      },
    );

    // Modify the file loader rule to ignore *.svg, since we have it handled now.
    fileLoaderRule.exclude = /\.svg$/i;

    // Wallet SDKs we deliberately don't ship.
    const unusedWalletSdks = [
      "@base-org/account",
      "@coinbase/wallet-sdk",
      "@metamask/connect-evm",
      "@walletconnect/ethereum-provider",
      "accounts",
      "porto",
      "porto/internal",
    ];

    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(unusedWalletSdks.map((pkg) => [pkg, false])),
    };

    return config;
  },
};

export default nextConfig;
