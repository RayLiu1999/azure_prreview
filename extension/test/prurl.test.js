import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePrUrl } from '../prurl.js'

test('損壞的 URL 編碼及無效 PR 編號回傳 null', () => {
  for (const path of ['%FF/P/_git/r/pullrequest/1', 'a/P/_git/r/pullrequest/0', 'a/P/_git/r/pullrequest/9007199254740993']) {
    assert.equal(parsePrUrl(`https://dev.azure.com/${path}`), null)
  }
})

test('拒絕非標準連接埠與帶有帳密的網址', () => {
  assert.equal(parsePrUrl('https://dev.azure.com:444/a/P/_git/r/pullrequest/1'), null)
  assert.equal(parsePrUrl('https://user:pass@dev.azure.com/a/P/_git/r/pullrequest/1'), null)
})

test('解析標準 PR 網址', () => {
  const url = 'https://dev.azure.com/contoso/Payments/_git/payments-api/pullrequest/1234'
  assert.deepEqual(parsePrUrl(url), {
    org: 'contoso',
    project: 'Payments',
    repo: 'payments-api',
    prId: 1234,
  })
})

test('忽略 query string 與 hash', () => {
  const url =
    'https://dev.azure.com/contoso/Payments/_git/payments-api/pullrequest/1234?_a=files#path=/src/a.cs'
  assert.equal(parsePrUrl(url).prId, 1234)
})

test('結尾多一個斜線仍可解析', () => {
  const url = 'https://dev.azure.com/contoso/Payments/_git/payments-api/pullrequest/1234/'
  assert.equal(parsePrUrl(url).prId, 1234)
})

test('專案名稱含空白（URL 編碼）會被還原', () => {
  const url = 'https://dev.azure.com/contoso/My%20Project/_git/my-repo/pullrequest/7'
  assert.equal(parsePrUrl(url).project, 'My Project')
})

test('repo 名稱含點號可解析', () => {
  const url = 'https://dev.azure.com/contoso/Proj/_git/Company.Api.Core/pullrequest/9'
  assert.equal(parsePrUrl(url).repo, 'Company.Api.Core')
})

test('PR 列表頁回傳 null', () => {
  assert.equal(
    parsePrUrl('https://dev.azure.com/contoso/Payments/_git/payments-api/pullrequests'),
    null
  )
})

test('repo 首頁回傳 null', () => {
  assert.equal(parsePrUrl('https://dev.azure.com/contoso/Payments/_git/payments-api'), null)
})

test('非 Azure DevOps 網域回傳 null', () => {
  assert.equal(parsePrUrl('https://contoso.visualstudio.com.evil.example/Proj/_git/repo/pullrequest/1'), null)
  assert.equal(parsePrUrl('https://github.com/a/b/pull/1'), null)
})

test('解析使用者提供的 visualstudio.com PR', () => {
  assert.deepEqual(parsePrUrl('https://kingnetrd.visualstudio.com/%E6%99%BA%E7%94%9F%E6%B4%BB-CMS%E9%9B%B2/_git/CMS-BonusDiscount/pullrequest/67066'), {
    org: 'kingnetrd', project: '智生活-CMS雲', repo: 'CMS-BonusDiscount', prId: 67066,
  })
})

test('http 協定回傳 null', () => {
  assert.equal(parsePrUrl('http://dev.azure.com/contoso/P/_git/r/pullrequest/1'), null)
})

test('PR 編號非數字回傳 null', () => {
  assert.equal(parsePrUrl('https://dev.azure.com/contoso/P/_git/r/pullrequest/abc'), null)
})

test('無效輸入回傳 null 而不是拋錯', () => {
  assert.equal(parsePrUrl(''), null)
  assert.equal(parsePrUrl('不是網址'), null)
  assert.equal(parsePrUrl(undefined), null)
  assert.equal(parsePrUrl(null), null)
})
