#!/bin/bash
# 基金复诊台 FundClinic · macOS 启动器
# 双击本文件, Finder 会用"终端"打开并执行它。

cd "$(dirname "$0")" || exit 1

echo ""
echo "  基金复诊台 FundClinic"
echo "  ============================================"

# ---- 检查 1: 有没有装 Node ----
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  [缺少 Node.js] 没有找到 node 命令。"
  echo ""
  echo "  这个工具需要一个本地 Node 服务来抓取公开数据,"
  echo "  因为浏览器直接抓天天基金 / 东方财富会被跨域安全策略拦住。"
  echo ""
  echo "  安装方式(二选一):"
  echo "    1. 打开 https://nodejs.org 下载 LTS 版 .pkg, 双击一路下一步"
  echo "    2. 如果装了 Homebrew:   brew install node"
  echo ""
  echo "  装完关掉这个窗口, 重新双击本文件。"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭..."
  echo ""
  exit 1
fi

# ---- 检查 2: 是不是只把这个启动文件单独拷出来了 ----
if [ ! -f "server.mjs" ]; then
  echo ""
  echo "  [文件不完整] 本目录下找不到 server.mjs。"
  echo ""
  echo "  本文件只是启动器, 它需要和整个项目文件夹在一起。"
  echo "  请不要只转发这一个文件, 要把整个文件夹(或压缩包)发过去。"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭..."
  echo ""
  exit 1
fi

# ---- 把常见工具目录补进 PATH ----
# 为什么必须做这一步(组员真实踩到): Finder 双击启动的进程**不读 ~/.zshrc / ~/.bash_profile**,
# 所以 PATH 只有系统默认的那几个目录 —— Homebrew(/opt/homebrew/bin)和
# Conda(~/miniconda3/bin 等)装的东西**统统找不到**。
# 表现就是"我明明装了 pdftotext, 工具还说未找到", 而且极难自己想到是 PATH 问题。
# 这里主动补上, 后面的 node 进程会继承, 于是工具的 PATH 兜底查找也能命中。
for d in \
  /opt/homebrew/bin /usr/local/bin /opt/local/bin \
  "$HOME/miniconda3/bin" "$HOME/anaconda3/bin" "$HOME/miniforge3/bin" "$HOME/mambaforge/bin" \
  "$HOME/opt/miniconda3/bin" "$HOME/opt/anaconda3/bin" "$HOME/opt/miniforge3/bin" \
  "/opt/homebrew/Caskroom/miniconda/base/bin" "/usr/local/Caskroom/miniconda/base/bin"
do
  if [ -d "$d" ]; then
    case ":$PATH:" in
      *":$d:"*) ;;
      *) PATH="$d:$PATH" ;;
    esac
  fi
done
export PATH

echo ""
echo "  正在启动本地服务, 稍等 2-3 秒会自动打开浏览器..."
echo "  如果浏览器没有自动打开, 请看下面打印的地址, 手动访问。"
echo "  关闭本窗口即停止服务。"
echo ""

# 浏览器由服务端在 listen 成功之后自己打开 —— 端口被占而顺延时,
# 打开的仍然是真实端口, 不会出现"打开了却是空白页"。
export FUNDCLINIC_OPEN=1
node server.mjs
