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

Chi phí thường trực của chính plugin khoảng **600 token mỗi session** (4 tool schema ≈ 447, description skill và agent ≈ 154).

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
| `search` | Mọi file text. Bỏ qua file nhị phân/NUL, giải mã được UTF-16LE/BE. Có thể giới hạn bằng `search.extensions`. |
| `outline` | Nhận diện khai báo theo heuristic cho C/C++/C#/Java/Kotlin, JS/TS, Python, Ruby, PHP, Go, Rust, Swift, Scala, Dart, shell, Lua, Perl và SQL. Là regex, không phải parser. |
| `build` | Chỉ .NET (MSBuild hoặc `dotnet`). Hệ sinh thái khác dùng lệnh build riêng; tool báo rõ thay vì đoán. |
| Skill, agent, `AGENTS.md` mẫu | Không phụ thuộc ngôn ngữ. |

## Thành phần

| Thành phần | Chức năng |
|---|---|
| `outline` | Liệt kê class/method kèm số dòng, thay cho đọc cả file |
| `search` | Tìm text hoặc `/regex/`, trả `file:line` + 2 dòng context, cap 30 match / 8 KB |
| `build` | Tự chọn MSBuild (legacy .NET Framework) hoặc `dotnet build` (SDK), giữ full log ở `.token-diet/build.log`, chỉ trả lỗi + warning gộp theo mã |
| `diet` | Báo cáo skill/plugin nào đang tốn token mỗi session |
| `token-diet:scout` | Subagent chỉ đọc, trả về `file:line`, không dán code |
| Hook `PreToolUse` | Chặn `Read` không `limit` trên file > 128 KB, `cat` file lớn, `grep -r` không giới hạn, `git log -p` không `-n` |
| Hook `PostToolUse` | Cảnh báo một lần khi cùng một lệnh lặp 3 lần |
| `/build`, `/diet` | Lệnh thủ công cho hai tool dùng nhiều nhất |

## Cấu hình

Sửa `plugins/token-diet/scripts/config.json`: `guard.read.maxBytes` (mặc định 128 KB), `guard.read.maxLimitLines` (400 — `limit` lớn hơn trên file lớn bị coi là đọc cả file), `guard.bash.denyRecursiveGrep`, `loopBreaker.threshold` (3), `build.toolchain` (`auto`/`msbuild`/`dotnet`), `build.msbuildPath`, `build.platform`, `search.extensions` (rỗng = mọi file text). Có hiệu lực từ lần gọi tool tiếp theo.

Đặt riêng trong `~/.zcode/token-diet.config.json` (hoặc đường dẫn ở `TOKEN_DIET_CONFIG`) để không mất khi update plugin; hai file được merge, giá trị của bạn thắng.

## Giới hạn

- Không tiết kiệm gì trong hội thoại ngắn.
- `outline` dùng regex, không phải Roslyn parser.
- Không giảm được chi phí nền của các skill/plugin khác — dùng `/diet` rồi tắt bớt.
- Hook chạy quyền user trên mọi tool call; đọc script trước khi bật.

## Benchmark

```sh
npm test                          # guard, config override, outline đa ngôn ngữ
node bench/mcp-smoke.mjs
node bench/measure.mjs
TOKEN_DIET_ERP_SLN=/path/to/Legacy.sln node bench/measure.mjs
```

Chi tiết xem [README.md](README.md).

## Giấy phép

MIT
