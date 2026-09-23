import { defineConfig, devices } from "@playwright/test"

// 受注処理などの基幹フローを、実際のブラウザ操作で検証するE2Eテストの設定。
// dev サーバー(npm run dev)に対して実行する（本番/ステージング環境へは接続しない）。
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false, // テストごとにSupabaseへ実データを作成するため、並列実行はしない
  workers: 1, // 複数ファイルが同時に実行されるとdevサーバー/実データへの同時アクセスで競合するため1に固定
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
