# ====== Node.js 运行环境 ======
FROM node:20-slim AS base

# 容器默认时区设为上海
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 设定工作目录
WORKDIR /app

# 拷贝依赖声明文件（利用 Docker 层缓存）
COPY package*.json ./

# 安装生产依赖
RUN npm config set registry https://mirrors.cloud.tencent.com/npm/ && \
    npm install --production

# ====== 安装 Playwright Chromium 浏览器（浏览器解析器） ======
# 抖音 JSVM 反爬需要 headless Chromium 在浏览器上下文中执行 API 请求，
# 绕过 JSVM 字节码验证，获取真实 API 响应数据
RUN npx playwright install-deps chromium && \
    npx playwright install chromium

# ====== 下载 iawia002/lux 视频解析工具 ======
# lux 是一个 Go 编写的 CLI 工具，内置抖音 X-Bogus 签名、快手等反爬机制，
# 以子进程方式调用：lux -j -i <url>
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends curl ca-certificates && \
    curl -fsSL "https://github.com/iawia002/lux/releases/download/v0.24.1/lux_0.24.1_Linux_x86_64.tar.gz" \
      -o /tmp/lux.tar.gz && \
    tar -xzf /tmp/lux.tar.gz -C /tmp/ && \
    mv /tmp/lux /usr/local/bin/lux && \
    chmod +x /usr/local/bin/lux && \
    rm -f /tmp/lux.tar.gz && \
    apt-get purge -y curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# 验证 lux 可用
RUN lux -v

# 拷贝源码
COPY src/ ./src/

# 暴露端口 — CloudRun 会通过 PORT 环境变量传入（通常 8080）
EXPOSE 3000

# 启动服务
CMD ["node", "src/index.js"]
