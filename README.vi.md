# ZCode Token Diet

Plugin ZCode giúp phiên làm việc không tự làm ngập context bằng cách đọc cả file, `grep -r` không giới hạn và log build thô — mà không nén lịch sử và không viết lại output của tool.

[English](README.md) · MIT · Node 18+

## Vấn đề

Mỗi ký tự tool trả về đều tốn token, và còn tốn lại ở các lượt sau vì nó nằm trong transcript. Ba kiểu gọi đắt tiền nhất thì hoàn toàn dự đoán được:

- mở file 3.000 dòng để tìm một method;
- `grep -r` trả về 9.000 match;
- log build 1.800 dòng warning, trong đó chỉ 3 mã là quan trọng.

## Kết quả đo

| Kịch bản | Trước | Sau | Giảm |
|---|---:|---:|---:|
| Đọc 1 file C# lớn | 38.749 | 1.761 | 95,5% |
| Tìm 1 symbol khắp repo | 9.218 | 1.698 | 81,6% |
| Log build nhiều warning | 55.783 | 461 | 99,2% |
| *thật* solution .NET Framework 59 project qua MSBuild | 27.258 | 2.104 | 92,3% |
| *thật* solution SDK-style qua `dotnet build` | 1.624 | 1.493 | 8,1% |

Dòng cuối là giới hạn thật: khi build đã chạy `-v:q` và fail sớm thì gần như không còn gì để nén. Plugin có lãi ở file lớn, tìm kiếm toàn repo và build nhiều warning.

Chi phí thường trực của chính plugin khoảng **780 token mỗi session** (5 tool schema ≈ 626, description skill và agent ≈ 154).

## Cài đặt

```text
/plugin marketplace add kzxl/zcode-token-diet
/plugin install token-diet@zcode-token-diet
```

Hoặc **Plugin Marketplace → + → Add Plugin Marketplace**, dán `kzxl/zcode-token-diet`, rồi cài **Token Diet**. Mở task mới sau khi cài: ZCode nạp skill, MCP tool, agent và hook ở đầu session.

Để áp dụng cả khi không chọn skill, chép [`AGENTS.md.sample`](plugins/token-diet/AGENTS.md.sample) vào `~/.zcode/AGENTS.md`. Tốn thêm khoảng 260 token/session.

## Hỗ trợ ngôn ngữ

| Lớp | Phạm vi |
|---|---|
| Guard | Mọi ngôn ngữ. Nó xét kích thước file và câu lệnh shell, không phân tích cú pháp. |
| `search` | Mọi file text. Bỏ qua file nhị phân/NUL, giải mã UTF-16LE/BE (có hoặc không BOM), tôn trọng `.gitignore`, cache nội dung giữa các lần gọi. Có thể giới hạn bằng `search.extensions`. |
| `outline` | Nhận diện khai báo theo heuristic cho C/C++/C#/Java/Kotlin, JS/TS, Python, Ruby, PHP, Go, Rust, Swift, Scala, Dart, shell, Lua, Perl và SQL. Là regex, không phải parser. |
| `build` / `run` | `build` chỉ .NET (MSBuild hoặc `dotnet`). `run` xử lý npm/pnpm/yarn, cargo, go, maven, gradle, make và pytest với lệnh cố định từng hệ sinh thái. |
| Skill, agent, `AGENTS.md` mẫu | Không phụ thuộc ngôn ngữ. |

## Thành phần

| Thành phần | Chức năng |
|---|---|
| `outline` | Liệt kê class/method kèm số dòng, thay cho đọc cả file |
| `search` | Tìm text hoặc `/regex/`, trả `file:line` + 2 dòng context, cap 30 match / 8 KB |
| `build` | Tự chọn MSBuild (legacy .NET Framework) hoặc `dotnet build` (SDK), giữ full log ở `.token-diet/build.log`, chỉ trả lỗi + warning gộp theo mã |
| `run` | Build/test/lint cho npm/pnpm/yarn, cargo, go, maven, gradle, make, pytest; trích lỗi theo định dạng từng công cụ |
| `diet` | Báo cáo skill/plugin nào đang tốn token mỗi session |
| `token-diet:scout` | Subagent chỉ đọc, trả về `file:line`, không dán code |
| Hook `PreToolUse` | Chặn `Read` không `limit` trên file > 128 KB, `cat` file lớn, `grep -r` không giới hạn, `git log -p` không `-n` |
| Hook `PostToolUse` | Cảnh báo một lần khi cùng một lệnh lặp 3 lần |
| `/build`, `/diet` | Lệnh thủ công cho hai tool dùng nhiều nhất |

## Cấu hình

Sửa `plugins/token-diet/scripts/config.json`: `guard.read.maxBytes` (mặc định 128 KB), `guard.read.maxLimitLines` (400 — `limit` lớn hơn trên file lớn bị coi là đọc cả file), `guard.bash.denyRecursiveGrep`, `loopBreaker.threshold` (3), `build.toolchain` (`auto`/`msbuild`/`dotnet`), `build.msbuildPath`, `build.platform`, `search.extensions` (rỗng = mọi file text). Có hiệu lực từ lần gọi tool tiếp theo.

Đặt riêng trong `~/.zcode/token-diet.config.json` (hoặc đường dẫn ở `TOKEN_DIET_CONFIG`) để không mất khi update plugin; hai file được merge, giá trị của bạn thắng.

Các khoá mới: `search.respectGitignore` (mặc định `true`), `search.cacheTtlMs` (30000), `search.cacheMaxBytes` (32 MB), `run.timeoutMs` (600000).

Override theo từng repo đặt ở `<repo>/.token-diet.json`; file này thắng file user.

## Panel (thử nghiệm)

Plugin khai báo một MCP App surface (`ui://token-diet/panel.html`) hiển thị ledger ở panel bên phải: token giữ khỏi context là số chính, kèm trung bình mỗi file, số lần chặn, số file, tool call, lượng output trong 24 giờ và các lần chặn gần nhất kèm kích thước. Không tốn token hội thoại. Nút **Reload** và mục auto-refresh (tắt / 3s / 5s / 10s / 30s, được ghi nhớ) gọi tool dữ liệu qua cầu MCP Apps, nên số liệu cập nhật tại chỗ mà không cần tải lại trang. Các lần refresh không ghi vào ledger.

ZCode coi surface của plugin là **panel mở thủ công**: nó không tự mở, kể cả khi kết quả tool yêu cầu inline. Plugin tài liệu chính thức cũng vậy. Mở panel **Token Diet** một lần từ panel bên phải; sau đó chỉ tốn một click và không tốn token hội thoại. `/saved` luôn trả báo cáo text, nên không mất gì khi panel đóng.

## Ledger tiết kiệm

Mỗi lần guard chặn và mỗi lần gọi MCP tool được ghi vào `~/.zcode/token-diet/ledger.jsonl` (đổi thư mục bằng `TOKEN_DIET_DATA`). `/saved [số ngày]` tổng hợp lại. Ghi ledger tốn ~0,35 ms; file local, tự xoay vòng ở 5 MB.

## Định hướng tiếp theo

Chi tiết và tiêu chí nghiệm thu: [ROADMAP.md](ROADMAP.md). Năm việc kế tiếp, theo thứ tự:

1. Thu hẹp hook: `PostToolUse` chỉ cho `Bash` — bỏ ~70 ms mỗi lần `Read`.
2. Context thích ứng: 1 dòng khi search có ≤10 match — đưa repo ít match từ 36–54% lên khoảng 60–70%.
3. Fallback encoding legacy, chỉ khi UTF-8 decode lỗi — xử lý 50 file bị ảnh hưởng trong ERP.
4. Đo chất lượng outline trên 20 file mỗi ngôn ngữ trước khi thêm tính năng outline.
5. Tinh chỉnh ngưỡng từ dữ liệu `/saved` sau một tuần dùng thật.

Tạm hoãn: index trên đĩa (cold search đã ≤220 ms), tích hợp SQLite usage DB, tree-sitter, bundle ripgrep.

## Giới hạn

- Không tiết kiệm gì trong hội thoại ngắn.
- `outline` dùng regex, không phải Roslyn parser.
- Không giảm được chi phí nền của các skill/plugin khác — dùng `/diet` rồi tắt bớt.
- `.gitignore` chỉ hỗ trợ tập con phổ biến; trỏ thẳng vào thư mục bị ignore vẫn tìm được.
- UTF-16 không BOM được suy đoán từ vị trí byte NUL; file lạ có thể bị coi là nhị phân.
- `run` dùng lệnh cố định, không chạy lệnh tuỳ ý.
- Guard bỏ qua chuỗi trong ngoặc và nội dung heredoc khi so khớp, nên không chặn nhầm commit hay script; đổi lại lệnh giấu trong `bash -c "..."` không được kiểm tra.
- Mỗi hook tốn ~70 ms trên Windows do spawn process; session 50 tool call tốn 3,5–7 giây chờ.
- Với repo ít match, tiết kiệm chỉ còn ~36% vì 2 dòng context mỗi match tốn hơn chính dòng match.
- Ledger đo bytes bị chặn, không phải token provider báo.
- Hook chạy quyền user trên mọi tool call; đọc script trước khi bật.

## Benchmark

```sh
npm test                          # guard, config override, outline đa ngôn ngữ
node bench/mcp-smoke.mjs
node bench/measure.mjs
TOKEN_DIET_ERP_SLN=/path/to/Legacy.sln node bench/measure.mjs
TOKEN_DIET_BENCH_REPOS="/repo/a;/repo/b" node bench/repo-bench.mjs
node bench/hook-bench.mjs
```

Chi tiết xem [README.md](README.md).

## Giấy phép

MIT
