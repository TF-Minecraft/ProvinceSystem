from .minecraftban import MinecraftBan

async def setup(bot):
    await bot.add_cog(MinecraftBan(bot))