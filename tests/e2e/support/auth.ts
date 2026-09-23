import type { Page } from "@playwright/test"

// /login で「200000」を入力すると管理者アカウントに解決されてログインする
// （このリポジトリで唯一動作確認済みの管理者ログイン経路。既存の運用と同じ）。
const ADMIN_LOGIN_CODE = "200000"

export async function loginAsAdmin(page: Page) {
  await page.goto("/login")
  await page.getByPlaceholder("パスワードを入力").fill(ADMIN_LOGIN_CODE)
  await page.getByRole("button", { name: "ログイン", exact: true }).click()
  await page.waitForURL("**/admin**", { timeout: 15_000 })
}
