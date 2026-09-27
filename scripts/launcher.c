#define _GNU_SOURCE
#include <errno.h>
#include <stdio.h>
#include <sys/mman.h>
#include <unistd.h>

extern const unsigned char vibecli_script[];
extern const unsigned char vibecli_script_end[];

int main(void) {
    // 脚本保存在匿名内存文件，避免占用宿主限额为 16 MiB 的临时目录。
    int descriptor = memfd_create("vibecli-bootstrap", 0);
    if (descriptor < 0) { perror("创建 VibeCLI 启动脚本失败"); return 1; }
    size_t remaining = (size_t)(vibecli_script_end - vibecli_script);
    const unsigned char *cursor = vibecli_script;
    while (remaining > 0) {
        ssize_t written = write(descriptor, cursor, remaining);
        if (written < 0 && errno == EINTR) { continue; }
        if (written <= 0) { perror("写入 VibeCLI 启动脚本失败"); return 1; }
        cursor += written;
        remaining -= (size_t)written;
    }
    if (lseek(descriptor, 0, SEEK_SET) < 0 || dup2(descriptor, STDIN_FILENO) < 0) {
        perror("读取 VibeCLI 启动脚本失败"); return 1;
    }
    if (descriptor != STDIN_FILENO) { close(descriptor); }
    execlp("node", "node", "--input-type=commonjs", "-", (char *)NULL);
    perror("启动 Node 运行时失败");
    return 1;
}
