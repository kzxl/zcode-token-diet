# Zero Token

Tường lửa token & Bộ công cụ tối ưu ngữ cảnh (Context) cho AI Coding Agent (**Google Antigravity 2.0** & **ZCode**).

Ngăn chặn các phiên làm việc của AI tự làm tràn bộ nhớ ngữ cảnh (Context Window) bởi các lệnh đọc toàn bộ file dung lượng lớn, tìm kiếm `grep`/`rg` không giới hạn và xuất log build hàng chục megabyte — mà không làm mất lịch sử hội thoại và không ghi đè output của công cụ.

[English](README.md) · MIT · Node 18+

```text
trước   Read / read_file OrderService.cs (136 KB)       ~38.700 tokens
sau     outline OrderService.cs                          ~1.470 tokens
        read_file StartLine=412 EndLine=452 (hoặc Read offset=412 limit=40)
```

## Vấn đề thực tế

Mỗi ký tự mà công cụ trả về cho Agent đều tính token, và chi phí này bị nhân lên theo cấp số cộng ở mỗi lượt trao đổi kế tiếp do toàn bộ transcript được gửi kèm vào Context Cache. Ba hành động gây lãng phí token nhiều nhất gồm:

- Mở toàn bộ file 3.000 dòng chỉ để xem 1 method duy nhất;
- Chạy lệnh tìm kiếm đệ quy toàn thư mục trả về 9.000 kết quả;
- Nạp toàn bộ log build 1.800 dòng warning khi chỉ có 3 mã lỗi cần quan tâm.

Những trường hợp này không cần sự phán đoán phức tạp từ mô hình — chúng chỉ cần một chốt chặn tự động ngay tại cửa ngõ gọi lệnh. Đó chính là nhiệm vụ của **Zero Token**.

## Kết quả đo lường thực tế

Quy đổi: 3,6 ký tự/token cho mã nguồn và 4 ký tự/token cho log. Các dòng đánh dấu *thật* được đo trên các dự án phần mềm doanh nghiệp thực tế.

| Kịch bản | Trước | Sau | Tiết kiệm |
|---|---:|---:|---:|
| Đọc 1 file C# lớn (đọc cả file) | 38.749 | 1.761 | **95,5%** |
| Tìm 1 symbol khắp repository (`grep -rn`) | 9.218 | 1.698 | **81,6%** |
| Đọc log build nhiều warning | 55.783 | 461 | **99,2%** |
| *thật* solution .NET Framework 59 dự án qua MSBuild | 27.258 | 2.104 | **92,3%** |
| *thật* solution SDK-style qua `dotnet build` | 1.624 | 1.493 | **8,1%** |

Chi phí duy trì thường trực của plugin chỉ khoảng **780 token mỗi session** (5 schema MCP tool ≈ 626 token, phần mô tả skill & agent ≈ 154 token). Chỉ cần chặn một lần đọc file 38k-token là đã đủ bù lại chi phí hoạt động của nhiều tháng.

Báo cáo benchmark chi tiết: xem tại [`bench/RESULTS.md`](bench/RESULTS.md).

## Khả năng hỗ trợ nền tảng

Zero Token hỗ trợ song song cả **Google Antigravity 2.0** và **ZCode** thông qua tầng adapter thống nhất:

| Nền tảng | Tích hợp Hook | Công cụ được kiểm soát | Giao diện tương tác |
|---|---|---|---|
| **Google Antigravity 2.0** | Hook `PreToolUse` qua `plugins/zero-token/hooks/` | `read_file`, `run_command` | Skills, MCP Server, quy tắc thường trực `rules/AGENTS.md` |
| **ZCode** | `PreToolUse` & `PostToolUse` qua `.zcode-plugin/` | `Read`, `Bash` | Skills, Commands, Agents, Giao diện Webview Dashboard |

## Các thành phần chính

| Thành phần | Cơ chế hoạt động |
|---|---|
| **Universal Guard** (`guard.mjs`) | Chặn đọc file quá khổ (`read_file` không khai báo khoảng dòng hoặc `Read` không giới hạn trên file >128 KB), chặn `cat`/`type` file lớn, chặn `grep -r` không giới hạn và `git log -p` thiếu `-n`. |
| **Loop Breaker** (`loop-breaker.mjs`) | Cảnh báo khi Agent lặp lại đúng 1 câu lệnh cùng tham số 3 lần liên tiếp. |
| **MCP Tool `outline`** | Trích xuất chữ ký class, struct, hàm, method kèm số dòng cho hơn 16 ngôn ngữ lập trình, thay thế việc đọc cả file. |
| **MCP Tool `search`** | Tìm kiếm text hoặc Regex, trả về `file:line` kèm 2 dòng ngữ cảnh, giới hạn tối đa 30 kết quả / 8 KB. |
| **MCP Tool `build`** | Chạy MSBuild hoặc `dotnet build`, lưu toàn bộ log gốc vào `.zero-token/build.log`, chỉ trả về lỗi thực và tổng hợp warning theo mã lỗi. |
| **MCP Tool `run`** | Hỗ trợ build/test/lint cho npm, pnpm, yarn, cargo, go, maven, gradle, make, pytest kèm bộ lọc lỗi tự động. |
| **MCP Tool `diet`** | Phân tích chi phí token của tất cả skills và MCP tool đang cài đặt trong môi trường làm việc. |
| **Savings Ledger** (`ledger.mjs`) | Ghi nhận chi tiết từng byte và token tiết kiệm vào file xoay vòng `~/.zero-token/ledger.jsonl`. |
| **Giao diện Dashboard** (`panel.html`) | Bảng điều khiển Webview hiển thị số token đã giữ lại khỏi context, số lần chặn và các hoạt động can thiệp gần nhất. |

## Hướng dẫn cài đặt

### Cách 1: Cài đặt tự động bằng PowerShell (Khuyên dùng)

Clone repo và chạy script cài đặt:

```powershell
git clone https://github.com/kzxl/zero-token.git
cd zero-token
./install.ps1
```

Script sẽ tự động tạo liên kết NTFS Junction trỏ từ thư mục cấu hình của cả 2 nền tảng về `plugins/zero-token`:
- Antigravity 2.0: `~/.gemini/config/plugins/zero-token`
- ZCode: `~/.zcode/plugins/zero-token`

### Cách 2: Qua ZCode Plugin Marketplace

Trong ZCode:

```text
/plugin marketplace add kzxl/zero-token
/plugin install zero-token@zero-token
```

Hoặc vào mục **Plugin Marketplace → + → Add Plugin Marketplace**, nhập `kzxl/zero-token` và bấm cài đặt **Zero Token**.

### Cách 3: Đăng ký MCP Server thủ công cho Antigravity 2.0

Nếu bạn muốn cấu hình riêng cho Antigravity như một MCP Server độc lập:

Thêm đoạn cấu hình sau vào `~/.gemini/config/mcp_config.json`:

```json
{
  "mcpServers": {
    "zero-token": {
      "command": "node",
      "args": [
        "C:/Users/<Username>/source/repos/zero-token/plugins/zero-token/scripts/mcp-server.mjs"
      ],
      "env": {
        "ZERO_TOKEN_WORKSPACE": "C:/path/to/your/workspace"
      }
    }
  }
}
```

## Cấu hình tùy biến

Zero Token áp dụng cơ chế kế thừa cấu hình theo thứ tự ưu tiên:
1. **Theo từng repository**: `<repo>/.zero-token.json` (ưu tiên cao nhất)
2. **Theo từng người dùng**: `~/.zero-token/config.json` (hoặc biến môi trường `ZERO_TOKEN_CONFIG`)
3. **Mặc định từ plugin**: `plugins/zero-token/scripts/config.json`

| Tham số | Mặc định | Ý nghĩa |
|---|---|---|
| `guard.enabled` | `true` | Bật/tắt toàn bộ tường lửa kiểm tra trước khi gọi lệnh. |
| `guard.read.maxBytes` | `131072` | Ngưỡng dung lượng file (128 KB) sẽ bị chặn nếu đọc không giới hạn. |
| `guard.read.suggestLines` | `200` | Số dòng gợi ý trong thông báo chặn. |
| `guard.read.maxLimitLines` | `400` | Nếu đọc file lớn nhưng yêu cầu trên 400 dòng sẽ bị chặn vì coi như đọc cả file. |
| `guard.bash.catMaxBytes` | `131072` | Giới hạn dung lượng khi xem qua lệnh `cat`/`Get-Content`/`type`. |
| `guard.bash.denyRecursiveGrep` | `true` | Chặn `grep -r` thiếu cờ giới hạn (`-l`, `-m` hoặc `head`). |
| `guard.bash.denyPatchLog` | `true` | Chặn `git log -p` thiếu `-n`. |
| `loopBreaker.enabled` | `true` | Bật phát hiện gọi lặp lệnh. |
| `loopBreaker.threshold` | `3` | Số lần lệnh giống hệt nhau trước khi cảnh báo. |
| `search.respectGitignore` | `true` | Tuân thủ quy tắc bỏ qua file của `.gitignore`. |
| `search.cacheTtlMs` | `30000` | Thời gian sống (TTL) của bộ nhớ đệm danh sách file (ms). |
| `search.cacheMaxBytes` | `33554432` | Dung lượng cache LRU cho nội dung file đã giải mã (32 MB). |
| `run.timeoutMs` | `600000` | Thời gian chờ tối đa cho các lệnh chạy trong công cụ `run`. |

## Theo dõi token tiết kiệm & Dashboard

Mọi lần guard can thiệp thành công và dung lượng tiết kiệm được lưu trữ tại:
- `~/.zero-token/ledger.jsonl` (tùy biến qua biến môi trường `ZERO_TOKEN_DATA`).

Để kiểm tra:
- Trong chat: Gõ `/zero-token status` hoặc `/saved [số ngày]`.
- Trong ZCode / MCP Apps: Mở giao diện bên phải `ui://zero-token/panel.html` để xem biểu đồ và đồng hồ đo token thời gian thực.

## Kiểm thử & Đo kiểm

Chạy toàn bộ bài test:

```sh
npm test                          # Chạy test suite: Guard, Regex ngôn ngữ, Parser build, Gitignore, Runner, Webview
npm run smoke                     # Kiểm tra bắt tay MCP Protocol và 5 công cụ
npm run bench                     # Đo kiểm kịch bản tổng hợp (xuất kết quả ra bench/RESULTS.md)
node bench/repo-bench.mjs         # Đo kiểm tốc độ trên 9 repository đa ngôn ngữ thực tế
node bench/hook-bench.mjs         # Đo độ trễ của hook và tốc độ ghi file ledger
```

Độ trễ trung bình của hook trên Windows là **~70 ms mỗi lần gọi** (thời gian khởi động tiến trình Node.js); việc ghi ledger chỉ tốn **0,35 ms**. Với một phiên làm việc gồm 50 lần gọi công cụ, tổng thời gian trễ chỉ khoảng 3,5 giây nhưng bảo vệ được hàng chục nghìn token.

## Giấy phép

Mã nguồn mở theo giấy phép MIT © [kzxl](https://github.com/kzxl)
