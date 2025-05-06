import * as fs from 'fs/promises';
import * as path from 'path';

interface TransFileMes{
    filePath:string;
    fileName:string;
}
/**
 * 获取文件夹下所有JSON文件路径（递归）
 * @param folderPath 文件夹路径
 * @returns 包含所有文件类型绝对路径的数组
 */
  export async function getFilesByFileType(folderPath: string,fileType:string): Promise<TransFileMes[]> {
    const files: TransFileMes[] = [];
    
    async function walkDir(currentPath: string) {
        try {
            const items = await fs.readdir(currentPath);
            
            for (const item of items) {
                const fullPath = path.join(currentPath, item);
                const stat = await fs.stat(fullPath);

                if (stat.isDirectory()) {
                    await walkDir(fullPath); // 递归子目录
                } else if (path.extname(item).toLowerCase() === `.${fileType}`) {
                    files.push({filePath:fullPath,fileName:item}); // 只收集JSON文件
                }
            }
        } catch (error) {
            console.error(`访问目录出错: ${currentPath}`, error);
        }
    }

    await walkDir(folderPath);
    return files;
}



