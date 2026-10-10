# 基金复诊台 FundClinic — 容器镜像
#
# 为什么需要 Dockerfile 而不是直接用云平台的 Node 运行时:
#   「官方季报 PDF 逐行对账」这一项依赖 pdftotext(Poppler)。纯 Node 运行时的镜像里没有它,
#   整条对账会降级成"未完成" —— 而这是本项目最核心的质检动作, 不能少。
#   这里显式装上 poppler-utils, 保证云端和本机跑出来的结果一致。
#
# 构建:  docker build -t fundclinic .
# 运行:  docker run -p 8787:8787 -e FUNDCLINIC_CLOUD=1 -e PORT=8787 fundclinic

FROM node:20-slim

# pdftotext + 中文字体(导出 PDF 时中文才不会变方框)
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils fonts-noto-cjk ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 本项目零依赖, 没有 node_modules 要装; 只拷源码
COPY . .

# 云模式: 监听 0.0.0.0 并接受平台注入的 PORT
ENV FUNDCLINIC_CLOUD=1
ENV NODE_ENV=production

# 平台会覆盖 PORT; 8787 只是本地 docker run 时的默认值
ENV PORT=8787
EXPOSE 8787

# 健康检查直接用 /api/health, 它就是页面顶部那条状态栏用的同一个接口
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
