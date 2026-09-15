import { createNode, type MindMap } from './model.ts'
export function clearSampleTree(): MindMap {
  const node = (text: string, children: string[] = []) => ({ ...createNode(text), children: children.map(t => createNode(t)) })
  return { theme: 'clear', layoutMode: 'right', root: {
    ...createNode('学习用思维导图'), children: [
      node('用户动机', ['学生：做出漂亮的东西','老师：更快讲清知识','家长：孩子主动学习']),
      node('真实价值', ['分类、提炼、组织','建立知识关系']),
      node('家长', ['孩子爱上整理知识','不再多刷 100 道题','一张图看清整个单元','引导学习成果','让复杂知识变简单']),
      { ...node('实用方向'), children: [node('老师', ['课本 → 学案','考前一张图复习']), node('学生', ['人人都能做的学霸笔记','AI 搭框架，你来思考','错题知识点速查地图','作文议论文结构图'])] },
    ],
  } }
}
